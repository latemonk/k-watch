/**
 * Loads src/services/analytics.ts with the Umami opt-in CONFIGURED.
 *
 * Since 45008d7 the analytics facade reads its Umami endpoint from
 * `import.meta.env.VITE_UMAMI_*` (opt-in, unset by default) instead of a
 * hardcoded upstream constant. Under `tsx --test` `import.meta.env` is
 * undefined, so a plain `import('../src/services/analytics.ts')` throws at
 * module load. Same fix as checkout-overlay-lifecycle / aviation-hydration-
 * path: bundle the real module with esbuild and inject `import.meta.env`
 * via `define`, then import the bundle from a data URL.
 *
 * The values below are a self-hosted operator's config (the shape the
 * opt-in exists for), NOT the upstream project's endpoint — tests must
 * never encode abacus.worldmonitor.app as an expected default again.
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_UMAMI_SCRIPT_SRC = 'https://umami.example.com/script.js';
export const TEST_UMAMI_WEBSITE_ID = '00000000-0000-4000-8000-000000000000';
// Both hostname forms listed on purpose: the tracker's data-domains check is
// an EXACT hostname match, so the loader must pass the operator's list
// through verbatim (apex + www) for analytics to work on either host.
export const TEST_UMAMI_DOMAINS = 'k-watch.onpod.ai,www.k-watch.onpod.ai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

export type AnalyticsModule = typeof import('../../src/services/analytics.ts');

let cached: Promise<AnalyticsModule> | null = null;

/**
 * Bundles and imports the REAL analytics module (full dependency graph —
 * after-paint scheduling included) exactly once per test process. Module
 * state (pending queue, load guards) is shared across calls, matching the
 * old shared `import('../src/services/analytics.ts')` semantics; tests
 * reset between cases via `resetAnalyticsForTesting()`.
 */
export function loadAnalyticsModule(): Promise<AnalyticsModule> {
  cached ??= (async () => {
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [resolve(repoRoot, 'src/services/analytics.ts')],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
      alias: { '@': resolve(repoRoot, 'src') },
      define: {
        'import.meta.env': JSON.stringify({
          DEV: false,
          VITE_UMAMI_SCRIPT_SRC: TEST_UMAMI_SCRIPT_SRC,
          VITE_UMAMI_WEBSITE_ID: TEST_UMAMI_WEBSITE_ID,
          VITE_UMAMI_DOMAINS: TEST_UMAMI_DOMAINS,
        }),
      },
    });
    const code = result.outputFiles[0]!.text;
    const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    return await import(dataUrl) as AnalyticsModule;
  })();
  return cached;
}
