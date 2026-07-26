#!/usr/bin/env node
/**
 * Recompute the `'sha256-…'` allowlist in every CSP `script-src` from the
 * inline scripts actually present in `dist/`.
 *
 * Why this exists
 * ---------------
 * The CSP used to read `script-src 'self' 'strict-dynamic'
 * 'nonce-wm-static-bootstrap' 'sha256-…'×8`. That nonce is a fixed string
 * baked into the HTML at build time and published in a static response
 * header, so anyone could read it and reuse it — and with `strict-dynamic`
 * a nonce'd injected script can pull in arbitrary further scripts. The
 * nonce was doing no work as a security control while masking hash drift:
 * two inline scripts in dashboard.html were executing on the nonce alone,
 * with no matching hash in the header.
 *
 * The nonce and `strict-dynamic` are gone. Inline scripts are now allowed
 * only by hash, external scripts only by an explicit host allowlist. Hashes
 * are generated here rather than hand-maintained, because hand-maintained is
 * exactly how the drift happened.
 *
 * Usage
 * -----
 *   node scripts/generate-csp-script-hashes.mjs           # rewrite in place
 *   node scripts/generate-csp-script-hashes.mjs --check   # CI: fail on drift
 *
 * Must run AFTER `vite build` — it reads dist/.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');

// Pages that carry their own CSP allowing 'unsafe-inline'. Their inline
// scripts are intentionally not hash-pinned; folding them into the global
// allowlist would widen it for every other page.
const SELF_CSP_PAGES = new Set(['wm-widget-sandbox.html']);

// Files whose CSP script-src should be regenerated.
const TARGETS = [
  'docker/nginx.conf',
  'docker/nginx-security-headers.conf',
  'vercel.json',
];

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * Inline scripts only — anything with a `src` attribute is an external load
 * governed by the host allowlist, not by a hash.
 */
function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const body = match[2];
    if (body.length === 0) continue;
    hashes.push(createHash('sha256').update(body, 'utf8').digest('base64'));
  }
  return hashes;
}

function collectHashes() {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `vite build` before this script.');
    process.exit(1);
  }
  const hashes = new Set();
  for (const file of htmlFiles(DIST)) {
    const name = relative(DIST, file);
    if (SELF_CSP_PAGES.has(name)) continue;
    for (const hash of inlineScriptHashes(readFileSync(file, 'utf8'))) {
      hashes.add(hash);
    }
  }
  return [...hashes].sort();
}

/**
 * Replace the sha256 run inside each `script-src` directive. Only script-src
 * is touched — style-src and friends keep whatever they already declare.
 * A directive with no existing hashes gets them appended, so this still works
 * the first time it runs against a freshly written header.
 */
function rewriteScriptSrc(source, hashes) {
  const tokens = hashes.map(h => `'sha256-${h}'`).join(' ');
  return source.replace(/script-src ([^;"]*)/g, (whole, body) => {
    const kept = body
      .split(/\s+/)
      .filter(token => token && !/^'sha256-/.test(token));
    // Keep hashes next to the other keyword sources, ahead of the trailing
    // 'wasm-unsafe-eval' if present, purely so the header reads consistently.
    const tail = kept.at(-1) === "'wasm-unsafe-eval'" ? kept.pop() : null;
    const rebuilt = [...kept, tokens, tail].filter(Boolean).join(' ');
    return `script-src ${rebuilt}`;
  });
}

const hashes = collectHashes();
if (hashes.length === 0) {
  console.error('No inline scripts found in dist/ — refusing to write an empty hash list.');
  process.exit(1);
}

let drifted = false;
for (const target of TARGETS) {
  const path = join(ROOT, target);
  if (!existsSync(path)) continue;
  const before = readFileSync(path, 'utf8');
  const after = rewriteScriptSrc(before, hashes);
  if (before === after) continue;
  drifted = true;
  if (CHECK) {
    console.error(`CSP script-src hashes are stale in ${target}.`);
  } else {
    writeFileSync(path, after);
    console.log(`updated ${target}`);
  }
}

if (CHECK && drifted) {
  console.error('Run `node scripts/generate-csp-script-hashes.mjs` and commit the result.');
  process.exit(1);
}

console.log(`CSP script-src: ${hashes.length} inline-script hash(es)${CHECK ? ' — up to date' : ''}`);
