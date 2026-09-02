// POST /api/pay/billing/cancel — 자동갱신 해지(남은 기간은 그대로 유지)
import { json } from '../../_kw-http.js';
import { readUserSession } from '../../_kw-user-session.js';
import { dbEnabled, q } from '../../_kw-db.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const s = await readUserSession(req);
  if (!s) return json(401, { error: 'login_required', message: '로그인이 필요해요.' });
  if (!dbEnabled()) return json(503, { error: 'db_not_configured' });
  const r = await q(`UPDATE kw_users SET sub_auto_renew = FALSE WHERE id = $1 RETURNING live_until`, [s.uid]);
  const until = r.rows[0]?.live_until ? new Date(r.rows[0].live_until).getTime() : null;
  return json(200, { ok: true, liveUntil: until });
}
