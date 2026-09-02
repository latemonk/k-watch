#!/usr/bin/env node
// scripts/kw-billing-renewal.mjs — K-Watch Pro 자동갱신 워커(supervisord 상주).
// 만료 12시간 안쪽의 자동갱신 구독을 한 시간마다 훑어 빌링키로 재결제한다.
//
// 이중결제 방어(intoon·sosigi 사고 기록 반영)
//  1) 단일 비행: 틱이 겹치지 않게 in-flight 플래그
//  2) 원자적 선점: UPDATE … renew_claimed_until = now()+2h WHERE 조건 RETURNING — 두 프로세스가
//     같은 행을 동시에 집지 못한다(재시작 중 재결제 방지)
//  3) 결정적 orderId(kwatch-renew-{uid}-{만료일}) + 토스 Idempotency-Key — 같은 주기에는
//     토스도 한 번만 승인한다
//  4) 실패 3회 → 자동갱신 off(사용자가 카드 다시 등록)
// DATABASE_URL·TOSS_SECRET_KEY 가 없으면 아무것도 하지 않고 대기만 한다(supervisord 재시작 루프 방지).
import pg from 'pg';

const PRODUCT = {
  name: 'K-Watch Pro 월 이용권',
  priceKrw: Math.max(1000, Number(process.env.KW_PRO_PRICE_KRW) || 29000),
  days: Math.max(7, Number(process.env.KW_PRO_DAYS) || 30),
};
const ORDER_PREFIX = (process.env.TOSS_ORDER_PREFIX || 'kwatch-').replace(/[^a-zA-Z0-9-_]/g, '') || 'kwatch-';
const TICK_MS = Math.max(60_000, Number(process.env.KW_RENEWAL_TICK_MS) || 3600_000);
const MAX_FAILS = 3;

import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const enabled = Boolean(process.env.DATABASE_URL && process.env.TOSS_SECRET_KEY);
  if (!enabled) {
    console.log('[kw-billing] disabled (DATABASE_URL or TOSS_SECRET_KEY missing) — idling');
    setInterval(() => {}, 1 << 30);
  } else {
    main();
  }
}

function makePool() {
  const u = new URL(process.env.DATABASE_URL);
  const ssl = u.searchParams.get('sslmode') && u.searchParams.get('sslmode') !== 'disable';
  u.searchParams.delete('sslmode');
  return new pg.Pool({ connectionString: u.toString(), ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 2 });
}

async function tossPost(path, body, idem) {
  const r = await fetch(`https://api.tosspayments.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.TOSS_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      ...(idem ? { 'Idempotency-Key': idem } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.message || `HTTP ${r.status}`); e.code = data?.code; throw e; }
  return data;
}

let inFlight = false;
async function main() {
  const pool = makePool();
  pool.on('error', (e) => console.error('[kw-billing] pool error:', e.message));
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try { await renewDue(pool); } catch (e) { console.error('[kw-billing] tick failed:', e.message); }
    finally { inFlight = false; }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, TICK_MS);
  console.log(`[kw-billing] renewal worker up — tick ${TICK_MS / 60000}min, product ₩${PRODUCT.priceKrw}/${PRODUCT.days}d`);
}

export async function renewDue(pool, now = new Date()) {
  // 원자적 선점: 만료 12h 이내·자동갱신·빌링키 보유·선점 안 됨(또는 선점 만료) 인 행을 최대 20개 집는다
  const claimed = await pool.query(
    `UPDATE kw_users SET renew_claimed_until = $1::timestamptz + interval '2 hours'
     WHERE id IN (
       SELECT id FROM kw_users
       WHERE sub_auto_renew AND toss_billing_key IS NOT NULL AND toss_customer_key IS NOT NULL
         AND live_until IS NOT NULL AND live_until < $1::timestamptz + interval '12 hours'
         AND (renew_claimed_until IS NULL OR renew_claimed_until < $1::timestamptz)
         AND sub_fail_count < $2
       ORDER BY live_until LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [now.toISOString(), MAX_FAILS]);
  let ok = 0, failed = 0;
  for (const u of claimed.rows) {
    const cycle = new Date(u.live_until).toISOString().slice(0, 10);
    const orderId = `${ORDER_PREFIX}renew-${u.id}-${cycle}`;
    const dup = (await pool.query('SELECT status FROM kw_payments WHERE order_id = $1', [orderId])).rows[0];
    if (dup?.status === 'paid') { await release(pool, u.id); continue; }
    if (!dup) {
      await pool.query(
        `INSERT INTO kw_payments (user_id, kind, order_id, order_name, amount_krw) VALUES ($1, 'renewal', $2, $3, $4)
         ON CONFLICT (order_id) DO NOTHING`, [u.id, orderId, `${PRODUCT.name} 갱신`, PRODUCT.priceKrw]);
    }
    try {
      const pay = await tossPost(`/v1/billing/${encodeURIComponent(u.toss_billing_key)}`, {
        customerKey: u.toss_customer_key, orderId, orderName: `${PRODUCT.name} 갱신`, amount: PRODUCT.priceKrw,
        customerEmail: u.email, customerName: `${u.name || u.email.split('@')[0]}#${u.id}`,
      }, orderId);
      await pool.query(`UPDATE kw_payments SET status = 'paid', payment_key = $1, paid_at = now() WHERE order_id = $2`, [pay.paymentKey, orderId]);
      await pool.query(
        `UPDATE kw_users SET live_until = GREATEST(live_until, $2::timestamptz) + ($3::int * interval '1 day'),
           plan = 'pro', sub_fail_count = 0, renew_claimed_until = NULL WHERE id = $1`,
        [u.id, now.toISOString(), PRODUCT.days]);
      ok++;
      console.log(`[kw-billing] renewed user ${u.id} (${orderId})`);
    } catch (e) {
      const fails = Number(u.sub_fail_count) + 1;
      await pool.query(`UPDATE kw_payments SET status = 'failed', fail_reason = $1 WHERE order_id = $2`, [String(e.message || e.code).slice(0, 200), orderId]);
      // 실패: 24시간 뒤 재시도(선점 해제 시각), 3회면 자동갱신 종료
      await pool.query(
        `UPDATE kw_users SET sub_fail_count = $2, sub_auto_renew = $3,
           renew_claimed_until = $4::timestamptz + interval '24 hours' WHERE id = $1`,
        [u.id, fails, fails < MAX_FAILS, now.toISOString()]);
      failed++;
      console.error(`[kw-billing] renewal failed user ${u.id} (${fails}/${MAX_FAILS}): ${e.code || ''} ${e.message}`);
    }
  }
  if (claimed.rows.length) console.log(`[kw-billing] tick: ${claimed.rows.length} due, ${ok} ok, ${failed} failed`);
  return { due: claimed.rows.length, ok, failed };
}

async function release(pool, id) {
  await pool.query('UPDATE kw_users SET renew_claimed_until = NULL WHERE id = $1', [id]);
}
