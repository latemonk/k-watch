import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  BASELINE_ADVISORIES_BY_LOCKFILE,
  collectAuditFindings,
  collectStaleBaselineEntries,
  collectUnbaselinedFindings,
  isInvokedAsScript,
} from '../.github/scripts/audit-production-dependencies.mjs';

function auditReportWith(via) {
  return {
    vulnerabilities: {
      [via.name]: {
        name: via.name,
        severity: via.severity,
        via: [via],
      },
    },
  };
}

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

describe('security audit baseline', () => {
  it('allows currently baselined high advisories', () => {
    // image-size JXL/HEIF DoS — baselined 2026-08-17 because no patched
    // release exists (vulnerable "<= 2.0.2", latest IS 2.0.2).
    const report = auditReportWith({
      name: 'image-size',
      severity: 'high',
      title: 'known image-size advisory',
      url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
    });

    assert.deepEqual(collectUnbaselinedFindings(report, 'pro-test/package-lock.json'), []);
    assert.deepEqual(collectUnbaselinedFindings(report, 'package-lock.json'), []);
  });

  it('ignores moderate production advisories for the high-severity PR gate', () => {
    const report = auditReportWith({
      name: 'uuid',
      severity: 'moderate',
      title: 'moderate advisory',
      url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq',
    });

    assert.deepEqual(collectAuditFindings(report), []);
  });

  it('fails a new unbaselined high advisory', () => {
    const report = auditReportWith({
      name: 'new-package',
      severity: 'high',
      title: 'new advisory',
      url: 'https://github.com/advisories/GHSA-1111-2222-3333',
    });

    assert.deepEqual(collectUnbaselinedFindings(report, 'package-lock.json'), [
      {
        id: 'GHSA-1111-2222-3333',
        name: 'new-package',
        severity: 'high',
        title: 'new advisory',
        url: 'https://github.com/advisories/GHSA-1111-2222-3333',
      },
    ]);
  });

  it('tracks a baseline entry for each audited lockfile', () => {
    assert.deepEqual(Object.keys(BASELINE_ADVISORIES_BY_LOCKFILE).sort(), [
      'blog-site/package-lock.json',
      'consumer-prices-core/package-lock.json',
      'docker/runtime-package-lock.json',
      'package-lock.json',
      'pro-test/package-lock.json',
      'scripts/package-lock.json',
    ]);
  });

  it('keeps consumer-prices-core on the Fastify v5 audit fix', () => {
    const packageJson = readRepoJson('consumer-prices-core/package.json');
    const lockfile = readRepoJson('consumer-prices-core/package-lock.json');

    assert.match(packageJson.dependencies.fastify, /^\^5\./);
    assert.match(packageJson.dependencies['@fastify/cors'], /^\^11\./);
    assert.match(packageJson.dependencies['js-yaml'], /^\^4\.(?:[2-9]|\d{2,})\./);
    assert.match(lockfile.packages['node_modules/fastify']?.version, /^5\./);
    assert.match(lockfile.packages['node_modules/@fastify/cors']?.version, /^11\./);
    assert.match(lockfile.packages['node_modules/js-yaml']?.version, /^4\.(?:[2-9]|\d{2,})\./);
    assert.deepEqual(BASELINE_ADVISORIES_BY_LOCKFILE['consumer-prices-core/package-lock.json'], []);
  });

  it('keeps the root esbuild audit fix scoped away from Vite build tooling', () => {
    const packageJson = readRepoJson('package.json');
    const lockfile = readRepoJson('package-lock.json');
    const rootEsbuild = lockfile.packages['node_modules/esbuild'];
    const vite = lockfile.packages['node_modules/vite'];
    const viteEsbuild = lockfile.packages['node_modules/vite/node_modules/esbuild'];

    assert.equal(packageJson.overrides?.esbuild, undefined);
    assert.equal(packageJson.overrides?.convex?.esbuild, '0.28.1');
    assert.equal(rootEsbuild?.version, '0.28.1');
    assert.equal(vite?.dependencies?.esbuild, '^0.25.0');
    assert.ok(viteEsbuild, 'Vite must keep its own esbuild when root uses the audit-patched version');
    assert.match(viteEsbuild.version, /^0\.25\./);
    assert.notEqual(viteEsbuild.version, rootEsbuild.version);
  });

  it('flags baseline entries that no longer match any current advisory', () => {
    const report = auditReportWith({
      name: 'image-size',
      severity: 'high',
      title: 'known image-size advisory',
      url: 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
    });

    // The still-present id is not reported as stale; its sibling entry
    // (absent from this report) is — this is the signal that a patched
    // image-size finally shipped and the baseline should be retired.
    assert.deepEqual(collectStaleBaselineEntries(report, 'pro-test/package-lock.json'), ['GHSA-w3rx-r6r6-pgpr']);
    // A lockfile with an empty baseline has nothing to mark stale.
    assert.deepEqual(collectStaleBaselineEntries(report, 'scripts/package-lock.json'), []);
  });

  it('treats a symlinked entry path as direct invocation (no silent fail-open)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-guard-'));
    try {
      const real = join(dir, 'audit.mjs');
      writeFileSync(real, '// stub\n');
      const link = join(dir, 'audit-link.mjs');
      symlinkSync(real, link);
      const moduleUrl = pathToFileURL(real).href;

      // Invoked through the symlink, the guard still fires (the bug being fixed).
      assert.equal(isInvokedAsScript(link, moduleUrl), true);
      assert.equal(isInvokedAsScript(real, moduleUrl), true);
      // A different file must not be mistaken for the module entry.
      assert.equal(isInvokedAsScript(join(dir, 'other.mjs'), moduleUrl), false);
      assert.equal(isInvokedAsScript(undefined, moduleUrl), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
