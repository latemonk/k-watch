// POST /api/pay/billing/complete {authKey, customerKey} — 빌링키 발급 + 첫 달 결제 + 이용권 연장.
import { json, readJson } from '../../_kw-http.js';
import { readUserSession } from '../../_kw-user-session.js';
import { dbEnabled, q } from '../../_kw-db.js';
import { payEnabled, tossPost, PRODUCT, ORDER_PREFIX, cardLabelOf } from '../../_kw-toss.js';
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const s = await readUserSession(req);
  if (!s) return json(401, { error: 'login_required', message: '로그인이 필요해요.' });
  if (!payEnabled() || !dbEnabled()) return json(503, { error: 'pay_not_configured', message: '결제 준비 중이에요.' });
  let body;
  try { body = await readJson(req); } catch { return json(400, { error: 'invalid JSON' }); }
  const authKey = String(body.authKey || '').trim();
  const customerKey = String(body.customerKey || '').trim();
  if (!authKey || !customerKey) return json(400, { error: 'authKey/customerKey required' });

  const u = (await q('SELECT * FROM kw_users WHERE id = $1', [s.uid])).rows[0];
  if (!u) return json(401, { error: 'login_required' });
  if (!u.toss_customer_key || u.toss_customer_key !== customerKey) {
    return json(400, { error: 'customer_key_mismatch', message: '카드 등록 정보가 맞지 않아요. 다시 시도해 주세요.' });
  }

  // 1) 빌링키 발급
  let issued;
  try {
    issued = await tossPost('/v1/billing/authorizations/issue', { authKey, customerKey });
  } catch (e) {
    console.warn('[kw-pay] issue billing key failed:', e.code, e.message);
    return json(402, { error: 'billing_issue_failed', message: `카드 등록에 실패했어요. ${e.message || ''}`.trim() });
  }

  // 2) 첫 결제 — 주문 먼저 기록(멱등키 = orderId)
  const orderId = `${ORDER_PREFIX}sub-${u.id}-${Date.now()}`;
  await q(
    `INSERT INTO kw_payments (user_id, kind, order_id, order_name, amount_krw) VALUES ($1, 'subscription', $2, $3, $4)`,
    [u.id, orderId, PRODUCT.name, PRODUCT.priceKrw],
  );
  let pay;
  try {
    pay = await tossPost(`/v1/billing/${encodeURIComponent(issued.billingKey)}`, {
      customerKey, orderId, orderName: PRODUCT.name, amount: PRODUCT.priceKrw,
      customerEmail: u.email, customerName: `${u.name || u.email.split('@')[0]}#${u.id}`,
    }, orderId);
  } catch (e) {
    await q(`UPDATE kw_payments SET status = 'failed', fail_reason = $1 WHERE order_id = $2`, [String(e.message || e.code).slice(0, 200), orderId]);
    // 빌링키는 저장해 두되 자동갱신은 켜지 않는다(사용자가 다시 시도)
    await q(`UPDATE kw_users SET toss_billing_key = $1, toss_card_label = COALESCE(toss_card_label, $2) WHERE id = $3`, [issued.billingKey, cardLabelOf(issued), u.id]);
    console.warn('[kw-pay] first charge failed:', e.code, e.message);
    return json(402, { error: 'charge_failed', message: `결제에 실패했어요. ${e.message || ''}`.trim() });
  }

  // 3) 이용권 연장 — 남은 체험·이용 기간 위에 얹는다(GREATEST)
  const r = await q(
    `WITH upd AS (
       UPDATE kw_users SET
         live_until = GREATEST(COALESCE(live_until, now()), now()) + ($2::int * interval '1 day'),
         plan = 'pro', toss_billing_key = $3, toss_card_label = $4,
         sub_auto_renew = TRUE, sub_fail_count = 0, renew_claimed_until = NULL
       WHERE id = $1 RETURNING live_until)
     UPDATE kw_payments SET status = 'paid', payment_key = $5, paid_at = now() WHERE order_id = $6
     RETURNING (SELECT live_until FROM upd) AS live_until`,
    [u.id, PRODUCT.days, issued.billingKey, cardLabelOf(pay) || cardLabelOf(issued), pay.paymentKey, orderId],
  );
  const liveUntil = r.rows[0] ? new Date(r.rows[0].live_until).getTime() : null;
  console.log(`[kw-pay] subscription started: user ${u.id} → ${liveUntil ? new Date(liveUntil).toISOString() : '?'}`);
  return json(200, { ok: true, liveUntil, orderId, amountKrw: PRODUCT.priceKrw });
}
