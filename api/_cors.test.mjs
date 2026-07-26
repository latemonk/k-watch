import { strict as assert } from 'node:assert';
import test from 'node:test';
import { getCorsHeaders, getPublicCorsHeaders, isDisallowedOrigin } from './_cors.js';

function makeRequest(origin) {
  const headers = new Headers();
  if (origin !== null) {
    headers.set('origin', origin);
  }
  return new Request('https://k-watch.onpod.ai/api/test', { headers });
}

const OWN_ORIGIN = 'https://k-watch.onpod.ai';

test('allows desktop Tauri origins', () => {
  const origins = [
    'https://tauri.localhost',
    'https://abc123.tauri.localhost',
    'tauri://localhost',
    'asset://localhost',
    'http://127.0.0.1:46123',
  ];

  for (const origin of origins) {
    const req = makeRequest(origin);
    assert.equal(isDisallowedOrigin(req), false, `origin should be allowed: ${origin}`);
    const cors = getCorsHeaders(req);
    assert.equal(cors['Access-Control-Allow-Origin'], origin);
    assert.equal(cors['Access-Control-Allow-Credentials'], 'true');
  }
});

test('rejects unrelated external origins', () => {
  const req = makeRequest('https://evil.example.com');
  assert.equal(isDisallowedOrigin(req), true);
  const cors = getCorsHeaders(req);
  assert.equal(cors['Access-Control-Allow-Origin'], OWN_ORIGIN);
  assert.equal(cors['Access-Control-Allow-Credentials'], 'true');
});

test('allows our own origin', () => {
  const req = makeRequest(OWN_ORIGIN);
  assert.equal(isDisallowedOrigin(req), false);
  assert.equal(getCorsHeaders(req)['Access-Control-Allow-Origin'], OWN_ORIGIN);
});

// This allowlist is paired with Access-Control-Allow-Credentials: true, so an
// entry is a standing grant for that domain's pages to make authenticated
// calls here. Upstream's worldmonitor.app is a third party to this fork; it
// was inherited from the upstream snapshot and must stay out. Same for the
// rest of the onpod platform — a *.onpod.ai wildcard would hand every
// co-tenant the same grant.
test('does not trust upstream or co-tenant origins', () => {
  const untrusted = [
    'https://worldmonitor.app',
    'https://www.worldmonitor.app',
    'https://api.worldmonitor.app',
    'https://worldmonitor-abc-eliewm.vercel.app',
    'https://agent-store.onpod.ai',
    'https://onpod.ai',
    'https://k-watch.onpod.ai.evil.example',
    'http://k-watch.onpod.ai',
  ];
  for (const origin of untrusted) {
    assert.equal(isDisallowedOrigin(makeRequest(origin)), true, `origin must be rejected: ${origin}`);
  }
});

test('requests without origin remain allowed', () => {
  const req = makeRequest(null);
  assert.equal(isDisallowedOrigin(req), false);
});

test('CORS allow headers include MCP transport headers', () => {
  const privateCors = getCorsHeaders(makeRequest(OWN_ORIGIN));
  const publicCors = getPublicCorsHeaders('POST, GET, OPTIONS');

  for (const cors of [privateCors, publicCors]) {
    const allowed = cors['Access-Control-Allow-Headers'];
    assert.match(allowed, /\bMcp-Session-Id\b/);
    assert.match(allowed, /\bMCP-Protocol-Version\b/);
    assert.match(allowed, /\bLast-Event-ID\b/);

    const exposed = cors['Access-Control-Expose-Headers'];
    assert.match(exposed, /\bMcp-Session-Id\b/);
    assert.match(exposed, /\bWWW-Authenticate\b/);
    assert.match(exposed, /\bRetry-After\b/);
    // IETF RateLimit fields so browser-context agents can self-throttle cross-origin.
    assert.match(exposed, /\bRateLimit-Policy\b/);
    assert.match(exposed, /\bRateLimit-Limit\b/);
    assert.match(exposed, /\bRateLimit-Remaining\b/);
    assert.match(exposed, /\bRateLimit-Reset\b/);
    // Bare combined member: match RateLimit NOT preceded by "-" (so it doesn't
    // just re-match the RateLimit-* fields above) and followed by a delimiter.
    assert.match(exposed, /(^|[\s,])RateLimit(,|$)/);
    assert.match(exposed, /\bX-RateLimit-Limit\b/);
    assert.match(exposed, /\bX-RateLimit-Remaining\b/);
    assert.match(exposed, /\bX-RateLimit-Reset\b/);
    assert.match(exposed, /\bX-WorldMonitor-Bbox\b/);
    assert.match(exposed, /\bX-WorldMonitor-Bbox-Missing\b/);
    assert.match(exposed, /\bX-WorldMonitor-Bbox-Invalid\b/);
    assert.match(exposed, /\bX-Military-Bbox\b/);
  }
});
