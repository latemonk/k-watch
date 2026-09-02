import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.WM_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxx';
delete process.env.KW_GATE_DISABLED;

const m = await import('./_kw-user-session.js');

function reqWithCookie(cookie) {
  return new Request('http://localhost/api/x', { headers: cookie ? { cookie } : {} });
}

test('issue → verify round-trips uid/email/until', async () => {
  const until = Date.now() + 3600e3;
  const { token, payload } = await m.issueUserSessionToken({ id: 7, email: 'a@b.kr', name: '홍길동', plan: 'trial', liveUntil: until });
  assert.match(token, /^kwu_/);
  const s = await m.verifyUserSessionToken(token);
  assert.ok(s);
  assert.equal(s.uid, 7);
  assert.equal(s.email, 'a@b.kr');
  assert.equal(s.until, until);
  assert.equal(payload.exp, s.exp);
});

test('tampered token is rejected', async () => {
  const { token } = await m.issueUserSessionToken({ id: 1, email: 'x@y.z', liveUntil: Date.now() + 1000 });
  const [body, sig] = token.slice(4).split('.');
  const bad = `kwu_${body}x.${sig}`;
  assert.equal(await m.verifyUserSessionToken(bad), null);
  assert.equal(await m.verifyUserSessionToken(`kwu_${body}.${sig.slice(0, -2)}aa`), null);
});

test('different secret rejects', async () => {
  const { token } = await m.issueUserSessionToken({ id: 1, email: 'x@y.z' });
  const stash = process.env.WM_SESSION_SECRET;
  process.env.WM_SESSION_SECRET = 'another-secret-that-is-also-32-chars-long-yy';
  try { assert.equal(await m.verifyUserSessionToken(token), null); }
  finally { process.env.WM_SESSION_SECRET = stash; }
});

test('resolveDataMode: no cookie → demo; live until → live; expired until → demo', async () => {
  assert.equal(await m.resolveDataMode(reqWithCookie('')), 'demo');
  const live = await m.issueUserSessionToken({ id: 2, email: 'l@k.w', liveUntil: Date.now() + 60_000 });
  assert.equal(await m.resolveDataMode(reqWithCookie(`wms_abc=1; kwu=${encodeURIComponent(live.token)}`)), 'live');
  const expired = await m.issueUserSessionToken({ id: 3, email: 'e@k.w', liveUntil: Date.now() - 1 });
  assert.equal(await m.resolveDataMode(reqWithCookie(`kwu=${encodeURIComponent(expired.token)}`)), 'demo');
  const none = await m.issueUserSessionToken({ id: 4, email: 'n@k.w' });
  assert.equal(await m.resolveDataMode(reqWithCookie(`kwu=${encodeURIComponent(none.token)}`)), 'demo');
});

test('KW_GATE_DISABLED forces live', async () => {
  process.env.KW_GATE_DISABLED = '1';
  try { assert.equal(await m.resolveDataMode(reqWithCookie('')), 'live'); }
  finally { delete process.env.KW_GATE_DISABLED; }
});

test('readCookie picks the right name among several', () => {
  assert.equal(m.readCookie('a=1; kwu=hello%20x; b=2', 'kwu'), 'hello x');
  assert.equal(m.readCookie('kwuX=1', 'kwu'), null);
});

test('set-cookie strings are HttpOnly + SameSite=Lax', () => {
  assert.match(m.userSessionSetCookie('t'), /^kwu=t; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
  assert.match(m.userSessionClearCookie(), /Max-Age=0/);
});
