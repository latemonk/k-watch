#!/usr/bin/env node
/**
 * Load the built dashboard behind the REAL production CSP and report any
 * securitypolicyviolation the page raises.
 *
 * The CSP is read out of docker/nginx.conf so this checks the header that
 * actually ships, not a copy that can drift. Static assets are served from
 * dist/; /api/* returns 503 because there is no backend here — data panels
 * failing is expected and ignored. Only CSP violations are treated as errors.
 *
 *   node scripts/verify-csp-runtime.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

const nginxConf = readFileSync(join(ROOT, 'docker/nginx.conf'), 'utf8');
// The dashboard CSP is the one carrying script-src hashes.
const CSP = nginxConf
  .split('\n')
  .map(line => line.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1])
  .filter(Boolean)
  .find(value => value.includes("'sha256-"));

if (!CSP) {
  console.error('Could not find the dashboard CSP in docker/nginx.conf');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"error":"no backend in csp verification"}');
    return;
  }
  let file = join(DIST, url.pathname === '/' ? 'dashboard.html' : url.pathname);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'dashboard.html');
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
  });
  res.end(body);
});

await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const violations = [];
await page.addInitScript(() => {
  globalThis.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (event) => {
    globalThis.__cspViolations.push({
      directive: event.effectiveDirective,
      blocked: String(event.blockedURI).slice(0, 160),
      sample: String(event.sample ?? '').slice(0, 120),
    });
  });
});
page.on('console', (msg) => {
  const text = msg.text();
  // Match only CSP refusals. A bare /Refused to (load|execute)/ also catches
  // MIME-type refusals (nosniff on a 404 that fell through to the SPA shell),
  // which have nothing to do with CSP — Chrome always names the policy in a
  // real CSP message.
  if (/Content Security Policy/i.test(text)) {
    violations.push({ directive: 'console', blocked: text.slice(0, 220), sample: '' });
  }
});

await page.goto(`${origin}/dashboard.html`, { waitUntil: 'load', timeout: 60_000 });
// Let deferred bootstrap work (after-paint chunks, dynamic imports) run.
await page.waitForTimeout(8_000);

violations.push(...(await page.evaluate(() => globalThis.__cspViolations ?? [])));

// Prove the bundle actually executed — a CSP that blocks everything would
// otherwise "pass" by producing no violations after a dead page load.
const booted = await page.evaluate(() =>
  document.querySelectorAll('script[type="module"]').length > 0 &&
  document.body.children.length > 1);

await browser.close();
server.close();

const unique = [...new Map(violations.map(v => [v.directive + v.blocked, v])).values()];
for (const v of unique) console.error(`CSP VIOLATION [${v.directive}] ${v.blocked} ${v.sample}`);

if (!booted) {
  console.error('Page did not boot — the CSP may be blocking the entry bundle.');
  process.exit(1);
}
if (unique.length > 0) {
  console.error(`\n${unique.length} CSP violation(s) under the shipping header.`);
  process.exit(1);
}
console.log('✅ dashboard booted with zero CSP violations under the shipping header');
