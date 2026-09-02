// GET /api/pay/history — 내 결제 내역(최근 30건)
import { json } from '../_kw-http.js';
import { readUserSession } from '../_kw-user-session.js';
import { dbEnabled, q } from '../_kw-db.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const s = await readUserSession(req);
  if (!s) return json(401, { error: 'login_required' });
  if (!dbEnabled()) return json(503, { error: 'db_not_configured' });
  const r = await q(
    `SELECT kind, order_id, order_name, amount_krw, status, created_at, paid_at, fail_reason
     FROM kw_payments WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, [s.uid]);
  return json(200, { items: r.rows });
}
