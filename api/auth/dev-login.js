// POST /api/auth/dev-login {token, email, name?} — 구글 크리덴셜 없이 로그인 세션을 만드는
// 운영자용 뒷문. KW_DEV_LOGIN_TOKEN 이 설정된 팟에서만 살아 있고 토큰이 일치해야 한다.
// 구글 로그인이 붙은 뒤에는 env 를 지워 끄는 것을 권장(e2e 검증엔 계속 유용).
import { json, readJson, publicOrigin, isLocalOrigin } from '../_kw-http.js';
import { issueUserSessionToken, userSessionSetCookie } from '../_kw-user-session.js';
import { dbEnabled, upsertGoogleUser, userToSession } from '../_kw-db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const expected = process.env.KW_DEV_LOGIN_TOKEN;
  if (!expected || expected.length < 16) return json(404, { error: 'not_found' });
  let body;
  try { body = await readJson(req); } catch { return json(400, { error: 'invalid JSON' }); }
  if (!body || typeof body.token !== 'string' || !timingSafeEqual(body.token, expected)) return json(403, { error: 'forbidden' });
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'email required' });
  if (!dbEnabled()) return json(503, { error: 'db_not_configured' });
  const row = await upsertGoogleUser({ sub: null, email, name: body.name || email.split('@')[0], picture: '' });
  const s = userToSession(row);
  const { token } = await issueUserSessionToken(s);
  return json(200, { ok: true, user: { id: row.id, email: row.email }, plan: s.plan, liveUntil: s.liveUntil || null },
    { 'Set-Cookie': userSessionSetCookie(token, { secure: !isLocalOrigin(publicOrigin(req)) }) });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
