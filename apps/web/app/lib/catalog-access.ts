const catalogReadPermissions = ["catalog.manage", "sales.confirm"] as const;

export type CatalogDetailMode = "manage" | "read-only" | "denied";

export function canManageCatalog(permissions: readonly string[]): boolean {
  return permissions.includes("catalog.manage");
}

export function canViewCatalog(permissions: readonly string[]): boolean {
  return catalogReadPermissions.some((permission) => permissions.includes(permission));
}

export function catalogDetailMode(permissions: readonly string[]): CatalogDetailMode {
  if (canManageCatalog(permissions)) {
    return "manage";
  }
  return canViewCatalog(permissions) ? "read-only" : "denied";
}
