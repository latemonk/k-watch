// 운영 환경 게이트: dev-login 은 KW_ENV=production 에서 절대 안 켜짐 · 운영자 이메일 거부 ·
// 부팅 검증(뒷문 토큰·공개 오리진·세션 키) · publicOrigin 헤더 폴백은 비운영에서만.
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.WM_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxx';
process.env.KW_ADMIN_EMAILS = 'ops@example.com';
delete process.env.KW_ENV;
delete process.env.KW_PUBLIC_ORIGIN;
delete process.env.KW_DEV_LOGIN_TOKEN;
delete process.env.KW_DEV_LOGIN_EMAILS;

const { isProduction, devLoginAllowed, devLoginEmailAllowed, bootEnvProblems, assertBootEnv } = await import('./_kw-env.js');
const { publicOrigin } = await import('./_kw-http.js');

const TOKEN = 'dev-login-token-0123456789abcdef';

test('devLoginAllowed: 비운영 + 토큰(≥16자) → 허용, 토큰 없음/짧음 → 거부', () => {
  assert.equal(devLoginAllowed({}), false);
  assert.equal(devLoginAllowed({ KW_DEV_LOGIN_TOKEN: 'short' }), false);
  assert.equal(devLoginAllowed({ KW_DEV_LOGIN_TOKEN: TOKEN }), true);
  assert.equal(devLoginAllowed({ KW_ENV: 'development', KW_DEV_LOGIN_TOKEN: TOKEN }), true);
});

test('devLoginAllowed: KW_ENV=production 이면 토큰이 있어도 거부', () => {
  assert.equal(isProduction({ KW_ENV: 'production' }), true);
  assert.equal(isProduction({ KW_ENV: ' Production ' }), true);
  assert.equal(devLoginAllowed({ KW_ENV: 'production', KW_DEV_LOGIN_TOKEN: TOKEN }), false);
});

test('devLoginEmailAllowed: 운영자 이메일은 항상 거부, 일반 이메일은 허용', () => {
  assert.equal(devLoginEmailAllowed('ops@example.com', {}), false);
  assert.equal(devLoginEmailAllowed(' OPS@Example.com ', {}), false);
  assert.equal(devLoginEmailAllowed('user@example.com', {}), true);
  assert.equal(devLoginEmailAllowed('', {}), false);
});

test('devLoginEmailAllowed: KW_DEV_LOGIN_EMAILS 가 있으면 그 목록만', () => {
  const env = { KW_DEV_LOGIN_EMAILS: 'e2e@example.com, qa@example.com' };
  assert.equal(devLoginEmailAllowed('e2e@example.com', env), true);
  assert.equal(devLoginEmailAllowed('QA@example.com', env), true);
  assert.equal(devLoginEmailAllowed('user@example.com', env), false);
  assert.equal(devLoginEmailAllowed('ops@example.com', { ...env, KW_DEV_LOGIN_EMAILS: 'ops@example.com' }), false, '운영자는 목록에 있어도 거부');
});

test('bootEnvProblems: 비운영은 검사 없음', () => {
  assert.deepEqual(bootEnvProblems({ KW_DEV_LOGIN_TOKEN: TOKEN }), []);
  assert.doesNotThrow(() => assertBootEnv({}));
});

test('bootEnvProblems: 운영 — 뒷문 토큰·오리진 누락·세션 키 누락 각각 잡힘', () => {
  const ok = { KW_ENV: 'production', KW_PUBLIC_ORIGIN: 'https://k-watch.onpod.ai', WM_SESSION_SECRET: 'x'.repeat(32), KW_ADMIN_EMAILS: 'ops@example.com' };
  assert.deepEqual(bootEnvProblems(ok), []);
  assert.doesNotThrow(() => assertBootEnv(ok));
  assert.equal(bootEnvProblems({ ...ok, KW_DEV_LOGIN_TOKEN: TOKEN }).length, 1);
  assert.equal(bootEnvProblems({ ...ok, KW_PUBLIC_ORIGIN: '' }).length, 1);
  assert.equal(bootEnvProblems({ ...ok, WM_SESSION_SECRET: '' }).length, 1);
  assert.throws(() => assertBootEnv({ ...ok, KW_DEV_LOGIN_TOKEN: TOKEN }), /KW_DEV_LOGIN_TOKEN/);
  assert.throws(() => assertBootEnv({ KW_ENV: 'production' }), /KW_PUBLIC_ORIGIN[\s\S]*WM_SESSION_SECRET/);
});

test('publicOrigin: env 가 있으면 항상 env(끝 슬래시 제거)', () => {
  process.env.KW_PUBLIC_ORIGIN = 'https://k-watch.onpod.ai/';
  try {
    const req = new Request('http://127.0.0.1:46123/api/auth/me', { headers: { 'x-forwarded-host': 'evil.example' } });
    assert.equal(publicOrigin(req), 'https://k-watch.onpod.ai');
  } finally { delete process.env.KW_PUBLIC_ORIGIN; }
});

test('publicOrigin: 비운영 + env 없음 → 헤더 폴백(개발 편의)', () => {
  const req = new Request('http://127.0.0.1:46123/api/auth/me', { headers: { 'x-forwarded-host': 'dev.local:5173', 'x-forwarded-proto': 'http' } });
  assert.equal(publicOrigin(req), 'http://dev.local:5173');
});

test('publicOrigin: 운영 + env 없음 → 헤더를 신뢰하지 않고 throw(fail closed)', () => {
  process.env.KW_ENV = 'production';
  try {
    const req = new Request('http://127.0.0.1:46123/api/auth/me', { headers: { 'x-forwarded-host': 'evil.example' } });
    assert.throws(() => publicOrigin(req), /KW_PUBLIC_ORIGIN/);
  } finally { delete process.env.KW_ENV; }
});
