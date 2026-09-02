// POST /api/pay/billing/prepare — 카드 등록 전 customerKey 준비.
// requestBillingAuth 와 빌링키 발급이 같은 customerKey 를 써야 하며, 한 번 정하면 바꾸지 않는다.
import { json, randomHex } from '../../_kw-http.js';
import { readUserSession } from '../../_kw-user-session.js';
import { dbEnabled, q } from '../../_kw-db.js';
import { payEnabled, PRODUCT } from '../../_kw-toss.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const s = await readUserSession(req);
  if (!s) return json(401, { error: 'login_required', message: '로그인이 필요해요.' });
  if (!payEnabled() || !dbEnabled()) return json(503, { error: 'pay_not_configured', message: '결제 준비 중이에요. 잠시 후 다시 시도해 주세요.' });
  const r = await q('SELECT id, email, name, toss_customer_key FROM kw_users WHERE id = $1', [s.uid]);
  const u = r.rows[0];
  if (!u) return json(401, { error: 'login_required' });
  let key = u.toss_customer_key;
  if (!key) {
    key = `kwatch-u${u.id}-${randomHex(6)}`;
    await q('UPDATE kw_users SET toss_customer_key = $1 WHERE id = $2 AND toss_customer_key IS NULL', [key, u.id]);
    const again = await q('SELECT toss_customer_key FROM kw_users WHERE id = $1', [u.id]);
    key = again.rows[0].toss_customer_key;
  }
  return json(200, { ok: true, customerKey: key, customerEmail: u.email, customerName: `${u.name || u.email.split('@')[0]}#${u.id}`, product: PRODUCT });
}
