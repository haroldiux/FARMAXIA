const catalogReadPermissions = ["catalog.manage", "sales.confirm"] as const;

export function canManageCatalog(permissions: readonly string[]): boolean {
  return permissions.includes("catalog.manage");
}

export function canViewCatalog(permissions: readonly string[]): boolean {
  return catalogReadPermissions.some((permission) => permissions.includes(permission));
}
