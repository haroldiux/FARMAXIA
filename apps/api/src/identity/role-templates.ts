/**
 * Permisos de farmacia y roles predefinidos. La migración 0016 crea lo mismo para las
 * farmacias existentes; el alta usa estas constantes para las nuevas.
 */
export const tenantPermissions = [
  { code: "catalog.manage", description: "Manage catalog and prices", label: "Administrar catálogo y precios", module: "Catálogo", sortOrder: 10 },
  { code: "inventory.manage", description: "Manage inventory operations", label: "Administrar inventario y compras", module: "Inventario", sortOrder: 20 },
  { code: "inventory.count.approve", description: "Approve physical inventory counts", label: "Aprobar conteos de inventario", module: "Inventario", sortOrder: 35 },
  { code: "inventory.report.global", description: "Read tenant-wide inventory reports", label: "Ver reporte global de inventario", module: "Inventario", sortOrder: 30 },
  { code: "cash.manage", description: "Manage cash registers and shifts", label: "Operar caja y turnos", module: "Caja y ventas", sortOrder: 40 },
  { code: "cash.shift.approve", description: "Approve non-zero cash shift differences", label: "Aprobar diferencias de caja", module: "Caja y ventas", sortOrder: 50 },
  { code: "sales.confirm", description: "Confirm non-fiscal cash sales", label: "Registrar ventas", module: "Caja y ventas", sortOrder: 60 },
  { code: "audit.read", description: "Read the tenant audit log within the plan retention", label: "Ver bitácora de auditoría", module: "Administración", sortOrder: 70 },
  { code: "billing.manage", description: "View the subscription, invoices and submit payments", label: "Ver suscripción y pagar", module: "Administración", sortOrder: 80 },
  { code: "users.manage", description: "Manage users, roles and branch access", label: "Administrar usuarios y roles", module: "Administración", sortOrder: 90 }
] as const;

export type TenantPermissionCode = (typeof tenantPermissions)[number]["code"];

export const ownerRoleCode = "owner";

export const systemRoles: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  permissions: readonly TenantPermissionCode[];
}> = [
  {
    code: ownerRoleCode,
    name: "Propietario",
    description: "Acceso total, incluida la suscripción y los usuarios.",
    permissions: tenantPermissions.map((permission) => permission.code)
  },
  {
    code: "regente",
    name: "Regente farmacéutico",
    description: "Catálogo, inventario, ventas y auditoría.",
    permissions: ["catalog.manage", "inventory.manage", "inventory.count.approve", "inventory.report.global", "sales.confirm", "audit.read"]
  },
  {
    code: "encargado",
    name: "Encargado de sucursal",
    description: "Operación completa de la sucursal, sin usuarios ni suscripción.",
    permissions: ["catalog.manage", "inventory.manage", "inventory.count.approve", "inventory.report.global", "cash.manage", "cash.shift.approve", "sales.confirm", "audit.read"]
  },
  { code: "cajero", name: "Cajero", description: "Caja y ventas.", permissions: ["cash.manage", "sales.confirm"] },
  { code: "almacenero", name: "Almacenero", description: "Inventario, compras y recepción.", permissions: ["inventory.manage"] }
];
