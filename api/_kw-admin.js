// K-Watch 슈퍼어드민 게이트 — 운영자 이메일 allowlist(KW_ADMIN_EMAILS, 쉼표 구분).
// 비로그인=401, 로그인했지만 운영자 아님=404(존재를 숨김).
import { json } from './_kw-http.js';
import { readUserSession } from './_kw-user-session.js';

const DEFAULT_ADMIN_EMAILS = 'charlespyo@gmail.com,pyo@ai3.kr';

export function adminEmails() {
  const raw = process.env.KW_ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAILS;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email) {
  if (!email) return false;
  return adminEmails().includes(String(email).trim().toLowerCase());
}

/** 운영자 세션이면 session 을, 아니면 바로 돌려줄 Response 를 반환한다. */
export async function requireAdmin(req) {
  const session = await readUserSession(req);
  if (!session) return { session: null, response: json(401, { error: 'login_required', message: '로그인이 필요해요.' }) };
  if (!isAdminEmail(session.email)) return { session: null, response: json(404, { error: 'not_found' }) };
  return { session, response: null };
}
