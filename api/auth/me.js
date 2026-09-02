// GET /api/auth/me — 현재 로그인·이용권 상태. 로그인 상태면 DB 로 갱신해 쿠키를 재발급한다
// (결제·체험 만료가 핫패스 쿠키에 반영되는 유일한 경로 — 프론트가 부트·결제 후·10분마다 호출).
import { json, publicOrigin, isLocalOrigin } from '../_kw-http.js';
import { readUserSession, issueUserSessionToken, userSessionSetCookie, userSessionClearCookie, gateDisabled } from '../_kw-user-session.js';
import { dbEnabled, getUserById, userToSession, trialDays } from '../_kw-db.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const now = Date.now();
  const base = {
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    payEnabled: Boolean(process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY && dbEnabled()),
    devLoginEnabled: Boolean(process.env.KW_DEV_LOGIN_TOKEN),
    gateDisabled: gateDisabled(),
    trialDays: trialDays(),
    serverTime: now,
  };
  const session = await readUserSession(req);
  if (!session) return json(200, { ...base, loggedIn: false, mode: base.gateDisabled ? 'live' : 'demo' });

  let fresh = session;
  let setCookie = null;
  if (dbEnabled()) {
    try {
      const row = await getUserById(session.uid);
      if (!row) return json(200, { ...base, loggedIn: false, mode: base.gateDisabled ? 'live' : 'demo' }, { 'Set-Cookie': userSessionClearCookie() });
      const s = userToSession(row);
      const issued = await issueUserSessionToken(s);
      fresh = issued.payload;
      setCookie = userSessionSetCookie(issued.token, { secure: !isLocalOrigin(publicOrigin(req)) });
      base.subscription = {
        autoRenew: Boolean(row.sub_auto_renew),
        cardLabel: row.toss_card_label || null,
        failCount: Number(row.sub_fail_count) || 0,
        hasBillingKey: Boolean(row.toss_billing_key),
      };
    } catch (e) {
      console.warn('[kw-auth] me: db refresh failed, serving cookie state:', e.message);
    }
  }
  const live = base.gateDisabled || (fresh.until > now);
  return json(200, {
    ...base,
    loggedIn: true,
    user: { id: fresh.uid, email: fresh.email, name: fresh.name, picture: fresh.picture },
    plan: fresh.plan,
    liveUntil: fresh.until || null,
    mode: live ? 'live' : 'demo',
  }, setCookie ? { 'Set-Cookie': setCookie } : {});
}
