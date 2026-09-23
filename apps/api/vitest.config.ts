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
      "test/subscription-quotas.spec.ts",
      "test/transversal-services.spec.ts",
      "test/platform-services.spec.ts",
      "test/catalog.spec.ts",
      "test/procurement.spec.ts",
      "test/inventory.spec.ts",
      "test/inventory-report.spec.ts",
      "test/cash.spec.ts",
      "test/sales.spec.ts"
    ],
    fileParallelism: false
  }
});
