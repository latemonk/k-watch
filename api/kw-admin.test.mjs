// 슈퍼어드민 게이트: allowlist 파싱·비로그인 401·비운영자 404·운영자 통과.
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.WM_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxx';
delete process.env.KW_ADMIN_EMAILS;

const { isAdminEmail, adminEmails, requireAdmin } = await import('./_kw-admin.js');
const { issueUserSessionToken } = await import('./_kw-user-session.js');

const reqWith = (token) => new Request('http://localhost/api/admin/stats', { headers: token ? { cookie: `kwu=${encodeURIComponent(token)}` } : {} });

test('allowlist: 기본값 없음 — env 비어 있으면 운영자 0명(공개 레포에 이메일 상수 없음)', () => {
  assert.deepEqual(adminEmails(), []);
  assert.equal(isAdminEmail('someone@example.com'), false);
  assert.equal(isAdminEmail('other@example.com'), false);
  assert.equal(isAdminEmail(''), false);
});

test('allowlist: KW_ADMIN_EMAILS 파싱 — 대소문자·공백 무시', () => {
  process.env.KW_ADMIN_EMAILS = 'a@x.io, b@y.io';
  try {
    assert.deepEqual(adminEmails(), ['a@x.io', 'b@y.io']);
    assert.equal(isAdminEmail(' A@X.io '), true);
    assert.equal(isAdminEmail('someone@example.com'), false);
  } finally { delete process.env.KW_ADMIN_EMAILS; }
});

test('requireAdmin: 비로그인 → 401', async () => {
  const { session, response } = await requireAdmin(reqWith(null));
  assert.equal(session, null);
  assert.equal(response.status, 401);
});

test('requireAdmin: 로그인했지만 운영자 아님 → 404(존재 숨김)', async () => {
  const { token } = await issueUserSessionToken({ id: 7, email: 'user@example.com', liveUntil: Date.now() + 60_000 });
  const { session, response } = await requireAdmin(reqWith(token));
  assert.equal(session, null);
  assert.equal(response.status, 404);
});

test('requireAdmin: 운영자(env 목록) → 세션 반환', async () => {
  process.env.KW_ADMIN_EMAILS = 'ops@example.com';
  try {
    const { token } = await issueUserSessionToken({ id: 1, email: 'ops@example.com', liveUntil: 0 });
    const { session, response } = await requireAdmin(reqWith(token));
    assert.equal(response, null);
    assert.equal(session.email, 'ops@example.com');
  } finally { delete process.env.KW_ADMIN_EMAILS; }
});

test('requireAdmin: env 비어 있으면 누구도 운영자가 아니다(404)', async () => {
  const { token } = await issueUserSessionToken({ id: 1, email: 'someone@example.com', liveUntil: 0 });
  const { session, response } = await requireAdmin(reqWith(token));
  assert.equal(session, null);
  assert.equal(response.status, 404);
});
