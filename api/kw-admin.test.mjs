// 슈퍼어드민 게이트: allowlist 파싱·비로그인 401·비운영자 404·운영자 통과.
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.WM_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxx';
delete process.env.KW_ADMIN_EMAILS;

const { isAdminEmail, adminEmails, requireAdmin } = await import('./_kw-admin.js');
const { issueUserSessionToken } = await import('./_kw-user-session.js');

const reqWith = (token) => new Request('http://localhost/api/admin/stats', { headers: token ? { cookie: `kwu=${encodeURIComponent(token)}` } : {} });

test('allowlist: 기본값에 charlespyo@gmail.com 포함, 대소문자·공백 무시', () => {
  assert.ok(adminEmails().includes('charlespyo@gmail.com'));
  assert.equal(isAdminEmail(' CharlesPyo@Gmail.com '), true);
  assert.equal(isAdminEmail('someone@example.com'), false);
  assert.equal(isAdminEmail(''), false);
});

test('allowlist: KW_ADMIN_EMAILS 가 있으면 기본값을 대체한다', () => {
  process.env.KW_ADMIN_EMAILS = 'a@x.io, b@y.io';
  try {
    assert.deepEqual(adminEmails(), ['a@x.io', 'b@y.io']);
    assert.equal(isAdminEmail('charlespyo@gmail.com'), false);
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

test('requireAdmin: 운영자 → 세션 반환', async () => {
  const { token } = await issueUserSessionToken({ id: 1, email: 'charlespyo@gmail.com', liveUntil: 0 });
  const { session, response } = await requireAdmin(reqWith(token));
  assert.equal(response, null);
  assert.equal(session.email, 'charlespyo@gmail.com');
});
