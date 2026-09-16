import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "test/health.e2e.spec.ts",
      "test/tenancy.rls.spec.ts",
      "test/auth.e2e.spec.ts",
      "test/tenant-resource-keys.spec.ts",
      "test/subscription-state.spec.ts",
      "test/subscription-quotas.spec.ts"
    ],
    fileParallelism: false
  }
});
