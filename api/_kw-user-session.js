// api/_kw-user-session.js
// K-Watch(KCG fork) 사람 계정 세션 — 구글 로그인으로 만든 사용자 쿠키.
//
// 업스트림의 `wms_` 세션(api/_session.js)은 익명이라 「누가·어떤 요금제로」를
// 담을 수 없다. 이 모듈은 그 옆에 별도 HttpOnly 쿠키(`kwu`)를 두고, 페이로드에
// 사용자 id·이메일·라이브 데이터 이용 만료시각(until)을 HMAC 서명으로 싣는다.
//
// 설계 요점
//  - 핫패스(선박 스냅샷·항공기 위치)는 DB 를 치지 않는다. 쿠키의 `until` 만
//    보고 라이브/데모를 가른다. 만료가 지나면 자동으로 데모로 떨어지고, 결제로
//    연장되면 /api/auth/me 가 쿠키를 재발급한다(프론트가 부트·결제 후 호출).
//  - 서명 키는 WM_SESSION_SECRET 재사용(팟 env 에 고정돼 있음). 재시작에도 유지.
//  - nginx 가 Authorization 헤더를 사이드카 토큰으로 덮어쓰므로 Bearer 는 못 쓴다.
//    쿠키만 통과한다(docker/nginx.conf `location /api/`).
//  - KW_GATE_DISABLED=1 이면 전부 라이브(운영자 킬스위치).

const COOKIE_NAME = 'kwu';
const PREFIX = 'kwu_';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const enc = new TextEncoder();

function getSecret() {
  const s = process.env.WM_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('WM_SESSION_SECRET must be set (min 32 chars)');
  return s;
}

async function importHmacKey() {
  return crypto.subtle.importKey('raw', enc.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(s) {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function stringToBase64Url(s) { return bufferToBase64Url(enc.encode(s).buffer); }
function base64UrlToString(s) { return new TextDecoder().decode(base64UrlToBytes(s)); }

/**
 * @typedef {Object} KwUserSession
 * @property {number} uid
 * @property {string} email
 * @property {string} name
 * @property {string} picture
 * @property {string} plan   'trial' | 'pro' | 'none'
 * @property {number} until  라이브 데이터 이용 만료(epoch ms). 0 = 없음
 * @property {number} iat
 * @property {number} exp
 */

/** @param {{id:number|string,email:string,name?:string,picture?:string,plan?:string,liveUntil?:number|string|Date|null}} user */
export async function issueUserSessionToken(user) {
  const until = toMs(user.liveUntil);
  const payload = {
    uid: Number(user.id),
    email: String(user.email || ''),
    name: String(user.name || '').slice(0, 80),
    picture: String(user.picture || '').slice(0, 300),
    plan: String(user.plan || 'none'),
    until,
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = stringToBase64Url(JSON.stringify(payload));
  const key = await importHmacKey();
  const sig = bufferToBase64Url(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return { token: `${PREFIX}${body}.${sig}`, exp: payload.exp, payload };
}

function toMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** @returns {Promise<KwUserSession|null>} */
export async function verifyUserSessionToken(token) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) return null;
  const tail = token.slice(PREFIX.length);
  const dot = tail.indexOf('.');
  if (dot < 0) return null;
  const body = tail.slice(0, dot);
  const sig = tail.slice(dot + 1);
  if (!body || !sig) return null;
  let key;
  try { key = await importHmacKey(); } catch { return null; }
  let expected;
  try { expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))); } catch { return null; }
  let provided;
  try { provided = base64UrlToBytes(sig); } catch { return null; }
  if (bufferToBase64Url(provided.buffer) !== sig) return null;
  if (expected.length !== provided.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(base64UrlToString(body)); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
  if (!Number.isFinite(Number(payload.uid))) return null;
  return {
    uid: Number(payload.uid),
    email: String(payload.email || ''),
    name: String(payload.name || ''),
    picture: String(payload.picture || ''),
    plan: String(payload.plan || 'none'),
    until: Number(payload.until) || 0,
    iat: Number(payload.iat) || 0,
    exp: payload.exp,
  };
}

/** Cookie 헤더에서 이름으로 값 하나 꺼내기 */
export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return part.slice(eq + 1).trim(); }
  }
  return null;
}

/** @param {Request|{headers:{get?:Function}|Record<string,string>}} req */
function cookieHeaderOf(req) {
  const h = req && req.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get('cookie') || h.get('Cookie') || '';
  return h.cookie || h.Cookie || '';
}

/** 요청에서 사용자 세션 읽기(서명·만료 검증). 없거나 깨졌으면 null. */
export async function readUserSession(req) {
  const raw = readCookie(cookieHeaderOf(req), COOKIE_NAME);
  if (!raw) return null;
  return verifyUserSessionToken(raw);
}

/** 라이브 데이터 이용 가능 여부 — 세션의 until 이 아직 남아 있으면 true */
export function sessionHasLiveAccess(session, nowMs = Date.now()) {
  return Boolean(session && session.until && session.until > nowMs);
}

export function gateDisabled() {
  const v = String(process.env.KW_GATE_DISABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * 이 요청에 실데이터를 줄지 — 'live' | 'demo'.
 * 게이트 킬스위치가 켜져 있으면 항상 'live'.
 */
export async function resolveDataMode(req) {
  if (gateDisabled()) return 'live';
  const session = await readUserSession(req);
  return sessionHasLiveAccess(session) ? 'live' : 'demo';
}

export function userSessionSetCookie(token, { maxAgeSeconds = SESSION_TTL_MS / 1000, secure = true } = {}) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(maxAgeSeconds)}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax`;
}
export function userSessionClearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export const KW_USER_COOKIE = COOKIE_NAME;
export const KW_USER_SESSION_TTL_MS = SESSION_TTL_MS;
