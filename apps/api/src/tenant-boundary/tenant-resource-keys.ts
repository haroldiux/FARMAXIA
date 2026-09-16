const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function buildTenantCacheKey(
  tenantId: string,
  branchId: string,
  namespace: string,
  key: string
): string {
  return `farmaxia:t:${segment("tenantId", tenantId)}:b:${segment("branchId", branchId)}:${segment(
    "namespace",
    namespace
  )}:${segment("key", key)}`;
}

export function tenantFileStorageKey(
  tenantId: string,
  branchId: string,
  fileId: string
): string {
  return `tenants/${segment("tenantId", tenantId)}/branches/${segment(
    "branchId",
    branchId
  )}/files/${segment("fileId", fileId)}`;
}

function segment(name: string, value: string): string {
  if (!safeSegment.test(value)) {
    throw new Error(`${name} must be a non-empty unambiguous key segment.`);
  }
  return value;
}
