import type { TourDefinition } from "./tours.ts";

/**
 * Dashboard Overview & Onboarding Walkthrough
 */
export const dashboardWelcomeTour: TourDefinition = {
  id: "dashboard-welcome",
  title: "Bienvenido a Farmaxia",
  description: "Recorrido guiado por el panel de control principal y métricas operativas.",
  module: "dashboard",
  steps: [
    {
      id: "kpis",
      targetSelector: '[data-tour="dashboard-kpis"]',
      title: "Indicadores Clave del Día",
      description:
        "Monitorea en tiempo real las ventas totales, transacciones realizadas y alertas prioritarias de stock por vencer.",
      placement: "bottom",
    },
    {
      id: "modules",
      targetSelector: '[data-tour="dashboard-modules"]',
      title: "Navegación de Módulos",
      description:
        "Accede rápidamente a Ventas POS, Inventario FEFO, Compras, Clientes, Personal y Análisis financiero.",
      placement: "top",
    },
    {
      id: "branch-status",
      targetSelector: '[data-tour="shell-branch-status"]',
      title: "Sucursal y Turno Activo",
      description:
        "Identifica la sucursal actual de trabajo y verifica el estado de apertura o cierre de la caja activa.",
      placement: "bottom",
    },
    {
      id: "plan-quota",
      targetSelector: '[data-tour="shell-plan-card"]',
      title: "Cuotas del Plan SaaS",
      description:
        "Revisa el uso de licencias: sucursales habilitadas, cajas registradoras activas y usuarios conectados.",
      placement: "top",
    },
  ],
};

/**
 * POS Sales Counter & Fast Checkout Walkthrough
 */
export const posCounterTour: TourDefinition = {
  id: "pos-counter",
  title: "Operación de Mostrador POS",
  description: "Aprende el flujo ágil de venta en mostrador, lectores de código de barras y cobros.",
  module: "sales",
  steps: [
    {
      id: "search-barcode",
      targetSelector: '[data-tour="pos-search"]',
      title: "Búsqueda Rápida y Código de Barras",
      description:
        "Presiona F2 o escanea con el lector láser para agregar productos al instante por código de barra o nombre comercial.",
      placement: "bottom",
      badge: "Atajo F2",
    },
    {
      id: "customer-loyalty",
      targetSelector: '[data-tour="pos-customer"]',
      title: "Cliente y Puntos de Fidelidad",
      description:
        "Asigna el cliente para acumular o canjear puntos de fidelidad y aplicar convenios de descuento corporativos.",
      placement: "bottom",
    },
    {
      id: "cart-fefo",
      targetSelector: '[data-tour="pos-cart"]',
      title: "Carrito y Selección de Lotes FEFO",
      description:
        "Gestiona cantidades, cambio de presentación (caja o blíster) y verifica la asignación automática por lote más próximo a vencer.",
      placement: "left",
    },
    {
      id: "quick-actions",
      targetSelector: '[data-tour="pos-quick-actions"]',
      title: "Acciones Rápidas de Caja",
      description:
        "Genera cotizaciones o proformas, registra egresos e ingresos de caja chica, o consulta ventas previas.",
      placement: "top",
    },
    {
      id: "tender-finish",
      targetSelector: '[data-tour="pos-tender"]',
      title: "Cobro Multimoneda y Emisión",
      description:
        "Acepta pagos en efectivo, tarjeta de débito/crédito, transferencias QR o puntos, y finaliza con F4 o F9.",
      placement: "top",
      badge: "Atajo F4 / F9",
    },
  ],
};

/**
 * Inventory FEFO & Audit Walkthrough
 */
export const inventoryOverviewTour: TourDefinition = {
  id: "inventory-overview",
  title: "Gestión Integral de Inventarios",
  description: "Control de almacenes, semáforo de vencimientos FEFO y auditorías.",
  module: "inventory",
  steps: [
    {
      id: "warehouses-control",
      targetSelector: '[data-tour="inventory-warehouses"]',
      title: "Almacenes y Zonas de Custodia",
      description:
        "Filtra y conmuta entre Almacén Central, Área de Cuarentena y Cámara de Cadena de Frío.",
      placement: "bottom",
    },
    {
      id: "fefo-traffic-light",
      targetSelector: '[data-tour="inventory-expiry-alerts"]',
      title: "Semáforo de Vencimientos FEFO",
      description:
        "Monitorea los lotes críticos clasificados en menos de 7 días, 30 días o 90 días para priorizar dispensación o devolución.",
      placement: "top",
    },
    {
      id: "batch-actions",
      targetSelector: '[data-tour="inventory-actions"]',
      title: "Acciones de Lotes y Bajas",
      description:
        "Envía lotes observados a cuarentena, libéralos tras inspección o genera actas formales de destrucción o baja.",
      placement: "left",
    },
    {
      id: "audit-report",
      targetSelector: '[data-tour="inventory-audit-report"]',
      title: "Auditoría de Conteo Ciego y Reporte",
      description:
        "Inicia tomas físicas de inventario a ciegas para evitar sesgos y exporta el reporte valorizado de existencias.",
      placement: "top",
    },
  ],
};

export const allTours: TourDefinition[] = [
  dashboardWelcomeTour,
  posCounterTour,
  inventoryOverviewTour,
];

/**
 * Returns the matching tour definition for a given URL pathname, or null if none is mapped.
 */
export function getTourForPathname(pathname: string): TourDefinition | null {
  if (!pathname || typeof pathname !== "string") {
    return null;
  }

  const trimmed = pathname.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase().replace(/\/+$/, "") || "/";

  if (normalized === "/dashboard" || normalized === "/") {
    return dashboardWelcomeTour;
  }

  if (normalized === "/sales" || normalized.startsWith("/sales/")) {
    return posCounterTour;
  }

  if (normalized === "/inventory" || normalized.startsWith("/inventory/")) {
    return inventoryOverviewTour;
  }

  return null;
}
