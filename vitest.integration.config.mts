import { defineConfig } from "vitest/config";

// Needs local Supabase and .env.local; see README.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["integration/**/*.test.ts"] },
});
