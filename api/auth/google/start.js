// GET /api/auth/google/start — 구글 로그인 시작(인가 코드 방식).
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 이 없으면 503 — 크리덴셜만 넣으면 켜진다.
// redirect_uri = {공개 오리진}/api/auth/google/callback (구글 콘솔에 그대로 등록).
import { json, redirect, publicOrigin, isLocalOrigin, randomHex } from '../../_kw-http.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return json(503, { error: 'google_login_not_configured', message: '구글 로그인이 아직 연결되지 않았어요. 잠시 후 다시 시도해 주세요.' });
  }
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const next = sanitizeNext(url.searchParams.get('next'));
  const state = randomHex(16);
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${origin}/api/auth/google/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  const secure = isLocalOrigin(origin) ? '' : 'Secure; ';
  const cookie = `kw_oauth=${encodeURIComponent(JSON.stringify({ s: state, n: next }))}; Path=/api/auth/google; Max-Age=600; HttpOnly; ${secure}SameSite=Lax`;
  return redirect(auth.toString(), { 'Set-Cookie': cookie });
}

function sanitizeNext(v) {
  if (!v || typeof v !== 'string') return '/';
  if (!v.startsWith('/') || v.startsWith('//')) return '/';
  return v.slice(0, 200);
}
