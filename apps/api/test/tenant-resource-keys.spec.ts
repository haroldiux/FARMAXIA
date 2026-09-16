import { describe, expect, it } from "vitest";
import {
  buildTenantCacheKey,
  tenantFileStorageKey
} from "../src/tenant-boundary/tenant-resource-keys.js";

const tenantId = "00000000-0000-4000-8000-000000000101";
const branchId = "00000000-0000-4000-8000-000000000121";
const fileId = "00000000-0000-4000-8000-000000000151";

describe("tenant resource keys", () => {
  it("prefixes cache and file keys with their exact tenant and branch", () => {
    expect(buildTenantCacheKey(tenantId, branchId, "catalog", "v1")).toBe(
      `farmaxia:t:${tenantId}:b:${branchId}:catalog:v1`
    );
    expect(tenantFileStorageKey(tenantId, branchId, fileId)).toBe(
      `tenants/${tenantId}/branches/${branchId}/files/${fileId}`
    );
  });

  it("rejects empty and ambiguous key segments", () => {
    expect(() => buildTenantCacheKey("", branchId, "catalog", "v1")).toThrow();
    expect(() => buildTenantCacheKey(tenantId, branchId, "catalog:all", "v1")).toThrow();
    expect(() => tenantFileStorageKey(tenantId, branchId, "../other-tenant")).toThrow();
  });
});
