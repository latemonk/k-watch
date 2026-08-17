import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { getCorsHeaders, isAllowedOrigin } from '../server/cors.ts';
import { isDisallowedOrigin as isDisallowedOriginJs } from '../api/_cors.js';
import { isAllowedOrigin as isAllowedOriginWorker } from '../workers/api-cors-preflight/src/index.js';

// Regression coverage for issue #3705: CORS-header generation errors must
// fail closed rather than fall back to a wildcard ACAO.

// Named for self-documenting failure messages and so a future companion
// guard elsewhere can re-use the same shape.
const WILDCARD_ACAO_LITERAL = /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/i;

// Strip JS line and block comments so the wildcard-literal guard only
// fires on real code, not on a comment that documents the anti-pattern
// (e.g. a future PR description quoted in JSDoc above the fail-closed
// branch). This keeps the test honest if someone documents the original
// bug verbatim while keeping the fix intact.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('cors helper', () => {
  it('returns headers for a well-formed request', () => {
    const req = new Request('https://k-watch.onpod.ai/x', {
      headers: { Origin: 'https://k-watch.onpod.ai' },
    });
    const headers = getCorsHeaders(req);
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://k-watch.onpod.ai');
    assert.match(
      headers['Access-Control-Allow-Headers'],
      /(?:^|,\s*)Idempotency-Key(?:,|$)/,
      'browser clients must be allowed to send Idempotency-Key on POST preflights',
    );
    assert.match(
      headers['Access-Control-Expose-Headers'],
      /(?:^|,\s*)Idempotency-Key(?:,|$)/,
      'browser clients must be able to read echoed Idempotency-Key',
    );
    assert.match(
      headers['Access-Control-Expose-Headers'],
      /(?:^|,\s*)Idempotent-Replayed(?:,|$)/,
      'browser clients must be able to read idempotent replay status',
    );
    assert.match(
      headers['Access-Control-Expose-Headers'],
      /(?:^|,\s*)X-RateLimit-Limit(?:,|$)/,
      'browser clients must be able to read rate-limit ceilings',
    );
    assert.match(
      headers['Access-Control-Expose-Headers'],
      /(?:^|,\s*)X-RateLimit-Remaining(?:,|$)/,
      'browser clients must be able to read remaining rate-limit budget',
    );
    assert.match(
      headers['Access-Control-Expose-Headers'],
      /(?:^|,\s*)X-RateLimit-Reset(?:,|$)/,
      'browser clients must be able to read rate-limit reset timestamps',
    );
  });

  it('propagates exceptions (caller must wrap in fail-closed try/catch)', () => {
    const throwingReq = {
      headers: {
        get(): string {
          throw new Error('simulated header failure');
        },
      },
    } as unknown as Request;
    assert.throws(() => getCorsHeaders(throwingReq), /simulated header failure/);
  });
});

// Commit 45008d7 removed trust in the upstream worldmonitor.app hosts and
// their "eliewm" Vercel preview scope: this allowlist is paired with
// Access-Control-Allow-Credentials: true, so an entry is a standing grant for
// that domain's pages to make authenticated cross-origin calls here — and the
// fork does not control the upstream domains. The former ALLOWED fixtures are
// kept below as REJECTED so the removal cannot silently regress.
describe('isAllowedOrigin — upstream worldmonitor.app trust removed (45008d7)', () => {
  // Origin for the JS twin (api/_cors.js exports isDisallowedOrigin, not the
  // bare predicate) — same allow/deny outcome proves both files stay in sync.
  const allowedByJsTwin = (origin: string) =>
    !isDisallowedOriginJs(new Request('https://k-watch.onpod.ai/x', { headers: { Origin: origin } }));

  // Positive control: the only allowed web origin is the fork's own host, so
  // the rejections below prove a tight allowlist rather than a broken predicate.
  const ALLOWED = [
    ['own K-Watch origin', 'https://k-watch.onpod.ai'],
  ];

  const REJECTED = [
    ['upstream git-branch alias URL (removed 45008d7)', 'https://worldmonitor-git-feature-eliewm.vercel.app'],
    ['upstream hash deployment URL (removed 45008d7)', 'https://worldmonitor-abc123def456-eliewm.vercel.app'],
    ['upstream worldmonitor.app apex (removed 45008d7)', 'https://worldmonitor.app'],
    ['upstream production subdomain (removed 45008d7)', 'https://tech.worldmonitor.app'],
    ['non-worldmonitor vercel.app origin', 'https://some-other-app-eliewm.vercel.app'],
    ['foreign team scope', 'https://worldmonitor-git-feature-attacker.vercel.app'],
    ['bare worldmonitor vercel.app (no scope segment)', 'https://worldmonitor.vercel.app'],
    ['suffix-spoofed eliewm origin', 'https://worldmonitor-git-feature-eliewm.vercel.app.evil.com'],
    ['dead personal-scope preview (post-migration)', 'https://worldmonitor-feature-elie-abc123.vercel.app'],
    ['suffix-spoofed own origin', 'https://k-watch.onpod.ai.evil.example'],
    ['co-tenant onpod.ai origin (no *.onpod.ai wildcard)', 'https://agent-store.onpod.ai'],
  ];

  for (const [label, origin] of ALLOWED) {
    it(`allows ${label}`, () => {
      assert.equal(isAllowedOrigin(origin), true, `server/cors.ts must allow ${origin}`);
      assert.equal(allowedByJsTwin(origin), true, `api/_cors.js must allow ${origin}`);
    });
  }

  for (const [label, origin] of REJECTED) {
    it(`rejects ${label}`, () => {
      assert.equal(isAllowedOrigin(origin), false, `server/cors.ts must reject ${origin}`);
      assert.equal(allowedByJsTwin(origin), false, `api/_cors.js must reject ${origin}`);
    });
  }
});

describe('CORS triplet parity — upstream origin patterns stay out of all three twins (45008d7)', () => {
  // Root cause of the original drift was twins moving separately. THREE
  // surfaces gate credentialed CORS and must move together; 45008d7 removed
  // the upstream worldmonitor.app hosts and the eliewm Vercel preview scope
  // from all of them, so guard each for:
  // (1) the fork's own k-watch.onpod.ai pattern is present (positive control
  //     that we are reading the real allowlist source),
  // (2) neither the eliewm preview pattern nor any worldmonitor.app host
  //     pattern reappears, and
  // (3) no bare *.vercel.app wildcard sneaks in as a "fix".
  // The Cloudflare Worker is the load-bearing one: it short-circuits OPTIONS at
  // the edge, so if it drifts wider it re-grants credentialed CORS before the
  // function-side allowlist is ever consulted.
  const TWINS = [
    '../server/cors.ts',
    '../api/_cors.js',
    '../workers/api-cors-preflight/src/index.js',
  ];

  for (const rel of TWINS) {
    it(`${rel} allows only the K-Watch origin pattern`, async () => {
      const source = await readFile(new URL(rel, import.meta.url), 'utf8');
      assert.ok(
        source.includes('k-watch\\.onpod\\.ai'),
        `${rel} must contain the k-watch.onpod.ai origin pattern`,
      );
      assert.ok(
        !source.includes('-eliewm\\.vercel\\.app'),
        `${rel} must not re-allow upstream eliewm.vercel.app previews (removed 45008d7)`,
      );
      // Matches the escaped-regex form only, so prose comments that mention
      // the upstream domain do not trip the guard — only a real pattern does.
      assert.ok(
        !source.includes('worldmonitor\\.app'),
        `${rel} must not re-allow upstream worldmonitor.app hosts (removed 45008d7)`,
      );
      assert.ok(
        !source.includes('worldmonitor-[a-z0-9-]+\\.vercel\\.app'),
        `${rel} must not widen to a bare *.vercel.app wildcard (security allowlist)`,
      );
    });
  }
});

describe('CORS Worker superset invariant — edge allowlist ⊇ function allowlist', () => {
  // The api-cors-preflight Worker (workers/api-cors-preflight) short-circuits
  // OPTIONS preflights at the edge, so its allowlist MUST be a superset of
  // api/_cors.js. If the Worker rejects an origin the function would accept,
  // the preflight echoes the canonical k-watch.onpod.ai fallback and the
  // browser blocks the request before it reaches the function.
  //
  // The Worker's own test (workers/api-cors-preflight/index.test.mjs) lives
  // OUTSIDE the test:data glob and only runs in deploy-worker.yml on
  // workers/** changes — so a function-only change can silently leave the
  // Worker narrower. THIS gate-resident check is what actually catches
  // function↔Worker drift (the bug that left eliewm previews dark).
  //
  // Localhost/127 are intentionally omitted: they are DEV-only on the function
  // side (NODE_ENV-gated) and never reach the prod-only Worker.
  const fnAllows = (origin: string) =>
    !isDisallowedOriginJs(new Request('https://k-watch.onpod.ai/x', { headers: { Origin: origin } }));

  const PROD_ORIGINS = [
    'https://k-watch.onpod.ai',
    'tauri://localhost',
    'asset://localhost',
    // Negatives — the function rejects these (upstream hosts removed 45008d7),
    // so the superset assertion is a no-op for them; included to document the
    // boundary.
    'https://worldmonitor.app',
    'https://www.worldmonitor.app',
    'https://tech.worldmonitor.app',
    'https://worldmonitor-git-feature-eliewm.vercel.app',
    'https://worldmonitor-abc123def456-eliewm.vercel.app',
    'https://some-other-app-eliewm.vercel.app',
    'https://worldmonitor-git-feature-attacker.vercel.app',
    'https://worldmonitor-feature-elie-abc123.vercel.app',
    'https://agent-store.onpod.ai',
    'https://evil.com',
  ];

  // Guard the guard: the fork's own origin MUST be in the allowed side of the
  // fixture set, otherwise the superset loop below degrades into all no-ops.
  it('fixture sanity — api/_cors.js allows the K-Watch origin', () => {
    assert.equal(fnAllows('https://k-watch.onpod.ai'), true);
  });

  for (const origin of PROD_ORIGINS) {
    it(`Worker allows everything the function allows: ${origin}`, () => {
      if (fnAllows(origin)) {
        assert.equal(
          isAllowedOriginWorker(origin),
          true,
          `Worker rejects ${origin} that api/_cors.js accepts — its OPTIONS preflight will echo the k-watch.onpod.ai fallback and the browser will block it`,
        );
      }
    });
  }
});

describe('gateway CORS error path (issue #3705)', () => {
  it('does not contain a wildcard ACAO fallback in source (comments stripped)', async () => {
    const source = await readFile(
      new URL('../server/gateway.ts', import.meta.url),
      'utf8',
    );
    // The pre-#3705 fallback was:
    //   corsHeaders = { 'Access-Control-Allow-Origin': '*' };
    // After stripping comments, no such literal should remain — that
    // would mean the wildcard widening regressed back into real code.
    assert.ok(
      !WILDCARD_ACAO_LITERAL.test(stripComments(source)),
      'gateway.ts must not emit wildcard ACAO in code — see issue #3705',
    );
  });

  it('routes CORS exceptions through captureSilentError + 500 (no wildcard)', async () => {
    const source = await readFile(
      new URL('../server/gateway.ts', import.meta.url),
      'utf8',
    );
    // The fail-closed branch must log the original error to Sentry AND
    // return a 5xx instead of a permissive CORS response. The gap is
    // bounded so we can tolerate minor refactoring inside the catch
    // (additional tags, intermediate variable names) without losing
    // the structural assertion.
    assert.ok(
      /catch \(err\)[\s\S]{0,500}captureSilentError\(err/.test(source),
      'gateway.ts cors catch must pass the original error to captureSilentError',
    );
    assert.ok(
      /step:\s*['"]cors_headers['"]/.test(source),
      'gateway.ts cors catch must tag Sentry events with step="cors_headers"',
    );
  });

  it('returns a non-cacheable 500 on CORS error so CDNs cannot pin it', async () => {
    const source = await readFile(
      new URL('../server/gateway.ts', import.meta.url),
      'utf8',
    );
    // Find the catch block for cors_headers and assert Cache-Control:
    // no-store appears inside the response headers within it.
    const catchBlock = source.match(/catch \(err\)[\s\S]{0,1500}?\n\s{4}\}/);
    assert.ok(catchBlock, 'expected to find the cors catch block in gateway.ts');
    assert.ok(
      /['"]Cache-Control['"]:\s*['"]no-store['"]/.test(catchBlock![0]),
      'cors fail-closed 500 must set Cache-Control: no-store',
    );
  });
});
