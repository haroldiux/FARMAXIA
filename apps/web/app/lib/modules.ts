import type { NavIconName } from "../components/nav-icon";

/**
 * Tonos de la paleta Bento, derivados de la identidad de FARMAXIA (azul de marca, marino,
 * lila, naranja, verde, ámbar y celeste de cadena de frío). Se definen en bento.css.
 */
export type Tone = "blue" | "indigo" | "lilac" | "orange" | "green" | "amber" | "sky";

export interface AppModule {
  key: string;
  label: string;
  icon: NavIconName;
  href: string;
  permission?: string;
  /** Color principal del módulo (encabezado, botones, contadores). */
  tone: Tone;
  /** Color secundario: alterna con el principal en las tarjetas de la página. */
  altTone: Tone;
  description: string;
}

// Secciones del menú lateral. Solo se muestran los módulos para los que el usuario tiene permiso.
export const moduleSections: Array<{ label: string; items: AppModule[] }> = [
  {
    label: "General",
    items: [{ key: "dashboard", label: "Resumen", icon: "overview", href: "/dashboard", tone: "blue", altTone: "lilac", description: "Tu farmacia de un vistazo" }]
  },
  {
    label: "Operación",
    items: [
      { key: "sales", label: "Ventas POS", icon: "sales", href: "/sales", permission: "sales.confirm", tone: "blue", altTone: "sky", description: "Cobra y descuenta stock por FEFO" },
      { key: "cash", label: "Caja y turnos", icon: "cash", href: "/cash", permission: "cash.manage", tone: "green", altTone: "blue", description: "Turnos, apertura y cierre de caja" },
      { key: "catalog", label: "Catálogo", icon: "catalog", href: "/catalog", permission: "catalog.manage", tone: "lilac", altTone: "blue", description: "Productos, ficha sanitaria y precios" },
      { key: "inventory", label: "Inventario", icon: "inventory", href: "/inventory", permission: "inventory.manage", tone: "sky", altTone: "green", description: "Lotes, vencimientos y almacenes" },
      { key: "procurement", label: "Compras", icon: "procurement", href: "/procurement", permission: "inventory.manage", tone: "orange", altTone: "amber", description: "Órdenes, recepción y facturas" }
    ]
  },
  {
    label: "Control",
    items: [
      { key: "report", label: "Reporte global", icon: "report", href: "/inventory/report", permission: "inventory.report.global", tone: "indigo", altTone: "sky", description: "Existencias de todas las sucursales" },
      { key: "audit", label: "Auditoría", icon: "audit", href: "/audit", permission: "audit.read", tone: "amber", altTone: "indigo", description: "Quién hizo qué y cuándo" }
    ]
  },
  {
    label: "Administración",
    items: [
      { key: "users", label: "Usuarios y roles", icon: "users", href: "/users", permission: "users.manage", tone: "lilac", altTone: "sky", description: "Equipo, permisos y sucursales" },
      { key: "billing", label: "Suscripción", icon: "billing", href: "/billing", permission: "billing.manage", tone: "indigo", altTone: "green", description: "Plan, límites y pagos" },
      { key: "account", label: "Mi cuenta", icon: "account", href: "/account", tone: "blue", altTone: "lilac", description: "Perfil, contraseña y 2FA" }
    ]
  }
];

export const allModules: AppModule[] = moduleSections.flatMap((section) => section.items);

/** Módulo de una ruta: el de href más largo que coincide (así /inventory/report es Reporte global). */
export function moduleForPath(pathname: string, modules: AppModule[] = allModules): AppModule | null {
  const matches = modules.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}
