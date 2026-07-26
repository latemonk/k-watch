import { defineConfig, devices } from '@playwright/test';

// Overridable so a run can dodge a port already taken by an unrelated local
// service. Default is unchanged, so CI and existing invocations behave as before.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90000,
  expect: {
    timeout: 30000,
  },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--use-gl=swiftshader'],
        },
      },
    },
  ],
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  webServer: {
    command: `VITE_E2E=1 npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `${ORIGIN}/tests/map-harness.html`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
