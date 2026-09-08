// POST /api/auth/dev-login {token, email, name?} — 구글 크리덴셜 없이 로그인 세션을 만드는
// 개발·검증용 뒷문. 운영(KW_ENV=production)에서는 어떤 값으로도 켜지지 않는다(404).
// 그 외 환경에서는 KW_DEV_LOGIN_TOKEN(≥16자) 일치 + 운영자 이메일이 아닐 때만(KW_DEV_LOGIN_EMAILS
// 가 있으면 그 목록만) 세션을 발급한다 — 뒷문으로 슈퍼어드민 세션을 만들 수 없다.
import { json, readJson, publicOrigin, isLocalOrigin } from '../_kw-http.js';
import { devLoginAllowed, devLoginEmailAllowed } from '../_kw-env.js';
import { issueUserSessionToken, userSessionSetCookie } from '../_kw-user-session.js';
import { dbEnabled, upsertGoogleUser, userToSession } from '../_kw-db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (!devLoginAllowed()) return json(404, { error: 'not_found' });
  const expected = process.env.KW_DEV_LOGIN_TOKEN;
  let body;
  try { body = await readJson(req); } catch { return json(400, { error: 'invalid JSON' }); }
  if (!body || typeof body.token !== 'string' || !timingSafeEqual(body.token, expected)) return json(403, { error: 'forbidden' });
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'email required' });
  if (!devLoginEmailAllowed(email)) return json(403, { error: 'forbidden' });
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
