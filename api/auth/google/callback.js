// GET /api/auth/google/callback — 인가 코드 → 토큰 → userinfo → 사용자 upsert → kwu 쿠키.
import { redirect, publicOrigin, isLocalOrigin } from '../../_kw-http.js';
import { readCookie, issueUserSessionToken, userSessionSetCookie } from '../../_kw-user-session.js';
import { dbEnabled, upsertGoogleUser, userToSession } from '../../_kw-db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const fail = (code) => redirect(`${origin}/?login=failed&reason=${encodeURIComponent(code)}`, { 'Set-Cookie': clearStateCookie(origin) });

  if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('missing_code');

  let stash = null;
  try { stash = JSON.parse(readCookie(req.headers.get('cookie'), 'kw_oauth') || 'null'); } catch { stash = null; }
  if (!stash || stash.s !== state) return fail('state_mismatch');
  if (!dbEnabled()) return fail('db_not_configured');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail('not_configured');

  let tokens;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    tokens = await r.json();
    if (!r.ok || !tokens.access_token) {
      console.warn('[kw-auth] token exchange failed:', r.status, tokens && tokens.error);
      return fail('token_exchange');
    }
  } catch (e) {
    console.warn('[kw-auth] token exchange error:', e.message);
    return fail('token_exchange');
  }

  let profile;
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000),
    });
    profile = await r.json();
    if (!r.ok || !profile.email) return fail('userinfo');
    if (profile.email_verified === false) return fail('email_unverified');
  } catch (e) {
    console.warn('[kw-auth] userinfo error:', e.message);
    return fail('userinfo');
  }

  let row;
  try {
    row = await upsertGoogleUser({ sub: profile.sub, email: profile.email, name: profile.name, picture: profile.picture });
  } catch (e) {
    console.error('[kw-auth] upsert failed:', e.message);
    return fail('db');
  }
  const { token } = await issueUserSessionToken(userToSession(row));
  const next = typeof stash.n === 'string' && stash.n.startsWith('/') && !stash.n.startsWith('//') ? stash.n : '/';
  const headers = new Headers({ Location: `${origin}${next}${next.includes('?') ? '&' : '?'}login=ok`, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', userSessionSetCookie(token, { secure: !isLocalOrigin(origin) }));
  headers.append('Set-Cookie', clearStateCookie(origin));
  return new Response(null, { status: 302, headers });
}

function clearStateCookie(origin) {
  return `kw_oauth=; Path=/api/auth/google; Max-Age=0; HttpOnly; ${isLocalOrigin(origin) ? '' : 'Secure; '}SameSite=Lax`;
}
