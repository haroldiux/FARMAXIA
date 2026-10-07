/**
 * Permisos de farmacia y roles predefinidos. La migración 0016 crea lo mismo para las
 * farmacias existentes; el alta usa estas constantes para las nuevas.
 */
export const tenantPermissions = [
  { code: "catalog.manage", description: "Manage catalog and prices", label: "Administrar catálogo y precios", module: "Catálogo", sortOrder: 10 },
  { code: "inventory.manage", description: "Manage inventory operations", label: "Administrar inventario y compras", module: "Inventario", sortOrder: 20 },
  { code: "inventory.count.approve", description: "Approve physical inventory counts", label: "Aprobar conteos de inventario", module: "Inventario", sortOrder: 35 },
  { code: "payables.manage", description: "Register supplier payments and schedule payables", label: "Registrar pagos a proveedores", module: "Compras", sortOrder: 25 },
  { code: "inventory.report.global", description: "Read tenant-wide inventory reports", label: "Ver reporte global de inventario", module: "Inventario", sortOrder: 30 },
  { code: "transfers.manage", description: "Request, dispatch and receive branch-to-branch transfers", label: "Solicitar, despachar y recibir traspasos", module: "Traspasos", sortOrder: 36 },
  { code: "transfers.approve", description: "Approve branch-to-branch transfer requests before dispatch", label: "Aprobar traspasos antes del despacho", module: "Traspasos", sortOrder: 37 },
  { code: "controlled.read", description: "Read the controlled-medicine prescription archive, balances and book", label: "Consultar medicamentos controlados", module: "Controlados", sortOrder: 38 },
  { code: "controlled.book.export", description: "Export the controlled-medicine book", label: "Exportar libro de controlados", module: "Controlados", sortOrder: 39 },
  { code: "cash.manage", description: "Manage cash registers and shifts", label: "Operar caja y turnos", module: "Caja y ventas", sortOrder: 40 },
  { code: "cash.shift.approve", description: "Approve non-zero cash shift differences", label: "Aprobar diferencias de caja", module: "Caja y ventas", sortOrder: 50 },
  { code: "sales.confirm", description: "Confirm non-fiscal cash sales", label: "Registrar ventas", module: "Caja y ventas", sortOrder: 60 },
  { code: "sales.read", description: "Read sales history, sale details and receipts", label: "Consultar ventas", module: "Caja y ventas", sortOrder: 65 },
  { code: "fiscal.read", description: "Read the fiscal invoice status of a sale", label: "Consultar comprobante fiscal", module: "Caja y ventas", sortOrder: 66 },
  { code: "sales.void", description: "Void sales and register returns", label: "Anular ventas y registrar devoluciones", module: "Caja y ventas", sortOrder: 67 },
  { code: "sales.fefo.override", description: "Choose a lot different from FEFO when selling", label: "Elegir lote distinto al FEFO", module: "Caja y ventas", sortOrder: 68 },
  { code: "customers.manage", description: "Register and edit customers, read their history and points", label: "Administrar clientes", module: "Clientes", sortOrder: 75 },
  { code: "loyalty.manage", description: "Configure loyalty points and adjust balances manually", label: "Administrar puntos de fidelidad", module: "Clientes", sortOrder: 76 },
  { code: "agreements.manage", description: "Manage agreements, their members and credit limits", label: "Administrar convenios", module: "Clientes", sortOrder: 77 },
  { code: "agreements.billing", description: "Issue agreement monthly statements and register their payments", label: "Facturar convenios", module: "Clientes", sortOrder: 78 },
  { code: "staff.shifts.manage", description: "Manage the branch work-shift roster", label: "Administrar turnos del personal", module: "Personal", sortOrder: 72 },
  { code: "staff.commissions.manage", description: "Manage sales commission rules and tiers", label: "Administrar comisiones de ventas", module: "Personal", sortOrder: 73 },
  { code: "staff.reports.read", description: "Read staff commission and productivity reports", label: "Ver reportes de personal", module: "Personal", sortOrder: 74 },
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
    permissions: ["catalog.manage", "inventory.manage", "inventory.count.approve", "inventory.report.global", "transfers.manage", "transfers.approve", "controlled.read", "controlled.book.export", "sales.confirm", "sales.read", "fiscal.read", "sales.void", "sales.fefo.override", "audit.read", "staff.shifts.manage", "staff.reports.read", "customers.manage"]
  },
  {
    code: "encargado",
    name: "Encargado de sucursal",
    description: "Operación completa de la sucursal, sin usuarios ni suscripción.",
    permissions: ["catalog.manage", "inventory.manage", "inventory.count.approve", "payables.manage", "inventory.report.global", "transfers.manage", "transfers.approve", "controlled.read", "cash.manage", "cash.shift.approve", "sales.confirm", "sales.read", "fiscal.read", "sales.void", "sales.fefo.override", "audit.read", "staff.shifts.manage", "staff.reports.read", "customers.manage", "agreements.manage"]
  },
  { code: "cajero", name: "Cajero", description: "Caja y ventas.", permissions: ["cash.manage", "sales.confirm", "sales.read", "fiscal.read", "customers.manage"] },
  { code: "almacenero", name: "Almacenero", description: "Inventario, compras y recepción.", permissions: ["inventory.manage", "transfers.manage"] }
];
