import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ["test/global-setup.ts"],
    include: [
      "test/health.e2e.spec.ts",
      "test/dependency-injection.spec.ts",
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
      "test/cash-movements.spec.ts",
      "test/sales.spec.ts",
      "test/permissions.guard.spec.ts",
      "test/saas.spec.ts",
      "test/identity.spec.ts",
      "test/catalog-profile.spec.ts",
      "test/inventory-operations.spec.ts",
      "test/sales-confirm.spec.ts",
      "test/sales-history.spec.ts",
      "test/sales-returns.spec.ts",
      "test/sales-lookup.spec.ts",
      "test/sales-fefo-override.spec.ts",
      "test/sales-quotes.spec.ts",
      "test/procurement-module4.spec.ts",
      "test/fiscal-invoices.spec.ts",
      "test/transfers.spec.ts",
      "test/transfers-approval.spec.ts",
      "test/controlled-prescriptions.spec.ts",
      "test/controlled-archive.spec.ts",
      "test/staff-shifts.spec.ts",
      "test/staff-commissions.spec.ts",
      "test/staff-productivity.spec.ts"
    ],
    fileParallelism: false
  }
});
