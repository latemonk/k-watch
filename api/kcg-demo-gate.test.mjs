// 데모 게이트 통합: 로그인 쿠키 없는 요청은 LLM·상류를 부르지 않고 시연 응답을 받는다.
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.WM_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long-xxx';
delete process.env.KW_GATE_DISABLED;
process.env.LLM_API_URL = 'http://127.0.0.1:9/never';
process.env.LLM_API_KEY = 'x';

const anomaly = (await import('./kcg-anomaly.js')).default;
const trace = (await import('./kcg-aircraft-trace.js')).default;
const { issueUserSessionToken } = await import('./_kw-user-session.js');
const { demoAircraftPositions } = await import('./_kw-demo-aircraft.js');

test('kcg-anomaly: demo request → canned verdict, no LLM call', async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('must not call upstream'); };
  try {
    const res = await anomaly(new Request('http://localhost/api/kcg-anomaly', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current: '선박 120척' }),
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.model, 'demo');
    assert.equal(body.triggered, false);
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('kcg-anomaly: live session → goes to the LLM path (upstream attempted)', async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response('{}', { status: 500 }); };
  try {
    const { token } = await issueUserSessionToken({ id: 1, email: 'l@k.w', liveUntil: Date.now() + 60_000 });
    const res = await anomaly(new Request('http://localhost/api/kcg-anomaly', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: `kwu=${encodeURIComponent(token)}` }, body: JSON.stringify({ current: '선박 120척' }),
    }));
    assert.ok(called >= 1, 'live request must reach the provider');
    assert.notEqual(res.status, 200);
  } finally { globalThis.fetch = realFetch; }
});

test('kcg-aircraft-trace: demo request serves synthetic trace/live for a demo hex without upstream', async () => {
  const hex = demoAircraftPositions(Date.now(), null)[0].icao24;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not call upstream'); };
  try {
    const t = await (await trace(new Request(`http://localhost/api/kcg-aircraft-trace?icao=${hex}`))).json();
    assert.equal(t.found, true);
    assert.ok(t.points.length > 0);
    const l = await (await trace(new Request(`http://localhost/api/kcg-aircraft-trace?icao=${hex}&live=1`))).json();
    assert.equal(l.found, true);
    assert.equal(l.hex, hex);
  } finally { globalThis.fetch = realFetch; }
});
