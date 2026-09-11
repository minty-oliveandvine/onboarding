// End-to-end tests. These run against a STACK THAT IS ALREADY UP -- they start nothing.
//
// Deliberately no `webServer` block: the wizard needs Next (3001), Flask (5001), the
// onboarding Django service (8001) and a real Postgres, and three of those four live in
// other repos. Booting them from here would hide which one is broken when a test fails,
// and would make a failure to start look like a failed assertion. Specs check the stack
// is reachable first and skip with a readable reason when it is not.
//
//   npm run test:e2e
//
// See e2e/README.md for the environment variables the authenticated specs need and for
// what this layer deliberately does NOT cover.

import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/urls';

export default defineConfig({
  testDir: './e2e',
  // One worker. The authenticated specs write to a shared dev database and restore what
  // they changed; running them concurrently would interleave those writes.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
