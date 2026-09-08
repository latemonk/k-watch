// api/_kw-http.js — K-Watch 계정·결제 라우트 공용 응답 헬퍼
export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...extraHeaders } });
}

/** 브라우저가 보는 공개 오리진(nginx 뒤라 req.url 의 scheme 은 http 로 보인다).
 *  운영(KW_ENV=production)에서는 KW_PUBLIC_ORIGIN 만 신뢰한다 — 요청 헤더(X-Forwarded-Host/Host)
 *  폴백은 개발·로컬 전용(호스트 헤더 주입으로 OAuth 실패 리다이렉트·redirect_uri 가 바뀌는 것 차단). */
export function publicOrigin(req) {
  const env = String(process.env.KW_PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (env) return env;
  if (String(process.env.KW_ENV || '').trim().toLowerCase() === 'production') {
    throw new Error('KW_PUBLIC_ORIGIN is required in production');
  }
  try {
    const u = new URL(req.url);
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
    const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return 'https://k-watch.onpod.ai';
  }
}

export function isLocalOrigin(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export async function readJson(req, maxBytes = 64 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) throw new Error('body too large');
  if (!text) return {};
  return JSON.parse(text);
}

export function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let s = '';
  for (const b of arr) s += b.toString(16).padStart(2, '0');
  return s;
}
