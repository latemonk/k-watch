// POST /api/auth/logout — kwu 쿠키 제거
import { json } from '../_kw-http.js';
import { userSessionClearCookie } from '../_kw-user-session.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  return json(200, { ok: true }, { 'Set-Cookie': userSessionClearCookie() });
}
