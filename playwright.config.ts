import { defineConfig, devices } from "@playwright/test";

// Runs against local Supabase (`npx supabase start`) with RESEND_API_KEY and
// SMTP_HOST unset, so app emails are logged and auth codes land in Mailpit.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  // One at a time: the specs share one database, and the cron checks count every firm in it.
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI tests a production build; locally the dev server starts faster and can be reused.
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // Emails are only logged, even when .env.local holds real Resend or SMTP settings.
    env: { RESEND_API_KEY: "", SMTP_HOST: "" },
  },
});
