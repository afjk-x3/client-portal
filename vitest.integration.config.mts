import { defineConfig } from "vitest/config";

// Needs local Supabase and .env.local; see README. The files share one database:
// fileParallelism is off so one run's runDailyJobs cannot claim another's outbox rows.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["integration/**/*.test.ts"], fileParallelism: false },
});
