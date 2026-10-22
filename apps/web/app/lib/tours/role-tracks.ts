/**
 * FARMAXIA - Role-Based Interactive Training Tracks
 * Concrete operational walkthrough workflows for the 5 core pharmacy roles:
 * Cajero, Almacenero, Regente Farmacéutico, Encargado de Sucursal, and Propietario.
 */

export interface TrainingStep {
  id: string;
  /** Where the learner is sent (may redirect, e.g. /branches -> /users?tab=branches). */
  path: string;
  /** Pathname where the target actually lives when it differs from `path` because of a redirect. */
  landingPath?: string;
  targetSelector: string;
  title: string;
  description: string;
  actionPrompt: string;
  interactiveAction?: TrainingAction;
  badge?: string;
}

/**
 * Every `interactiveAction` a track step may wait for. The UI reports each one through
 * `notifyAction` (or `useTrainingViewAction`); a test keeps this list, the tracks and the UI in sync.
 */
export const SUPPORTED_TRAINING_ACTIONS = [
  "open_shift",
  "search_product",
  "link_customer",
  "confirm_sale",
  "open_receipt",
  "choose_receipt_width",
  "record_movement",
  "close_shift",
  "view_orders",
  "receive_batch",
  "check_fefo_alerts",
  "quarantine_batch",
  "create_waste_act",
  "view_controlled_catalog",
  "submit_prescription",
  "view_prescription_archive",
  "view_controlled_book",
  "request_transfer",
  "schedule_shift",
  "approve_difference",
  "view_warehouses",
  "review_kpis",
  "create_user",
  "check_quotas",
  "review_analytics",
] as const;

export type TrainingAction = (typeof SUPPORTED_TRAINING_ACTIONS)[number];

export interface RoleTrainingTrack {
  id: string;
  roleCode: "cajero" | "almacenero" | "regente" | "encargado" | "owner";
  title: string;
  description: string;
  icon: string;
  estimatedDurationMinutes: number;
  steps: TrainingStep[];
}

/**
 * Track 1: Cajero (POS, Cash Register, Shift Lifecycle)
 */
export const cajeroTrainingTrack: RoleTrainingTrack = {
  id: "track-cajero",
  roleCode: "cajero",
  title: "Entrenamiento de Cajero / Ventas POS",
  description:
    "Aprende el flujo de apertura de turno, búsqueda rápida de productos con lector o F2, atención al cliente, cobros combinados y arqueo de cierre.",
  icon: "cash",
  estimatedDurationMinutes: 10,
  steps: [
    {
      id: "cajero-open-shift",
      path: "/cash",
      targetSelector: '[data-tour="cash-open-shift"]',
      title: "Apertura de Turno con Fondo Inicial",
      description:
        "Todo cajero debe registrar su fondo para cambio en gaveta antes de iniciar la venta al público.",
      actionPrompt: "Ingresa 200.00 BOB como fondo inicial y abre tu turno de caja.",
      interactiveAction: "open_shift",
      badge: "Caja",
    },
    {
      id: "cajero-pos-search",
      path: "/sales",
      targetSelector: '[data-tour="pos-search"]',
      title: "Búsqueda Rápida de Medicamentos",
      description:
        "Usa el lector de código de barras o presiona la tecla F2 para localizar productos por nombre o principio activo.",
      actionPrompt: "Escribe 'Paracetamol' y agrégalo al carrito de venta.",
      interactiveAction: "search_product",
      badge: "Atajo F2",
    },
    {
      id: "cajero-pos-customer",
      path: "/sales",
      targetSelector: '[data-tour="pos-customer"]',
      title: "Cliente y Puntos de Fidelidad",
      description:
        "Asociar al cliente a la venta acumula sus puntos y permite canjearlos como medio de pago.",
      actionPrompt: "Busca a 'María' en el campo Cliente y selecciónala para ver su saldo de puntos.",
      interactiveAction: "link_customer",
      badge: "Puntos",
    },
    {
      id: "cajero-pos-confirm",
      path: "/sales",
      targetSelector: '[data-tour="pos-tender"]',
      title: "Cobro Multimoneda y Emisión",
      description:
        "Registra pagos en efectivo, transferencias QR o tarjeta y calcula el cambio correspondiente.",
      actionPrompt: "Elige cobro en Efectivo con monto exacto y presiona 'Confirmar venta (F9)'.",
      interactiveAction: "confirm_sale",
      badge: "Atajo F4 / F9",
    },
    {
      id: "cajero-receipt-open",
      path: "/sales",
      targetSelector: '[data-tour="pos-receipt-link"]',
      title: "Recibo de la Venta",
      description:
        "Cada venta confirmada genera un recibo no fiscal que puedes mostrar al cliente o imprimir.",
      actionPrompt: "Presiona 'Ver / imprimir recibo' en el cuadro de venta confirmada.",
      interactiveAction: "open_receipt",
      badge: "Recibo",
    },
    {
      id: "cajero-receipt-width",
      path: "/sales",
      landingPath: "/sales/[saleId]",
      targetSelector: '[data-tour="receipt-width"]',
      title: "Papel Térmico de 58 u 80 mm",
      description:
        "El recibo se adapta al ancho de tu impresora térmica; la elección se recuerda en este equipo.",
      actionPrompt: "Alterna entre 58 mm y 80 mm y observa cómo cambia la vista previa.",
      interactiveAction: "choose_receipt_width",
      badge: "58 / 80 mm",
    },
    {
      id: "cajero-petty-cash",
      path: "/cash",
      targetSelector: '[data-tour="cash-movements"]',
      title: "Movimientos Menores de Caja Chica",
      description:
        "Registra salidas menores autorizadas de dinero (insumos de limpieza, gastos de farmacia) con motivo explícito.",
      actionPrompt: "Registra un egreso de 30.00 BOB por compra de insumos de limpieza.",
      interactiveAction: "record_movement",
      badge: "Egresos",
    },
    {
      id: "cajero-close-shift",
      path: "/cash",
      targetSelector: '[data-tour="cash-close-shift"]',
      title: "Arqueo y Cierre de Turno",
      description:
        "Al finalizar tu horario, cuenta el efectivo físico en gaveta para contrastarlo con el cálculo del sistema.",
      actionPrompt: "Ingresa el monto de efectivo contado en gaveta y presiona 'Cerrar turno'.",
      interactiveAction: "close_shift",
      badge: "Arqueo",
    },
  ],
};

/**
 * Track 2: Almacenero (Procurement, Receiving, FEFO Expiry, Waste Acts)
 */
export const almaceneroTrainingTrack: RoleTrainingTrack = {
  id: "track-almacenero",
  roleCode: "almacenero",
  title: "Entrenamiento de Almacenero / Logística",
  description:
    "Aprende a recibir mercadería de proveedores, verificar lotes con fechas de vencimiento, controlar semáforos FEFO y emitir actas de baja.",
  icon: "inventory",
  estimatedDurationMinutes: 12,
  steps: [
    {
      id: "almacen-orders-list",
      path: "/procurement",
      targetSelector: '[data-tour="procurement-orders"]',
      title: "Órdenes de Compra Pendientes",
      description:
        "Revisa las órdenes autorizadas pendientes de entrega de los laboratorios y distribuidores.",
      actionPrompt: "Consulta la orden de compra pendiente de Laboratorios Bagó.",
      interactiveAction: "view_orders",
    },
    {
      id: "almacen-batch-receiving",
      path: "/procurement/receiving",
      targetSelector: '[data-tour="procurement-receiving-form"]',
      title: "Recepción Física e Ingreso de Lote",
      description:
        "Registra la cantidad física recibida, el número de lote de fábrica y su fecha de expiración.",
      actionPrompt: "Ingresa el código de lote y fecha de vencimiento del producto recibido.",
      interactiveAction: "receive_batch",
      badge: "Recepción",
    },
    {
      id: "almacen-fefo-traffic",
      path: "/inventory",
      targetSelector: '[data-tour="inventory-expiry-alerts"]',
      title: "Inspección del Semáforo FEFO",
      description:
        "Monitorea los lotes críticos clasificados en 7, 30 y 90 días para evitar vencimientos en estantería.",
      actionPrompt: "Filtra los productos que vencen en los próximos 30 días.",
      interactiveAction: "check_fefo_alerts",
      badge: "FEFO",
    },
    {
      id: "almacen-quarantine",
      path: "/inventory",
      targetSelector: '[data-tour="inventory-actions"]',
      title: "Aislamiento en Cuarentena",
      description:
        "Si un lote presenta roturas de empaque o fallas de cadena de frío, aíslalo de inmediato.",
      actionPrompt: "Envía el lote observado a la zona de cuarentena con motivo 'Daño de empaque'.",
      interactiveAction: "quarantine_batch",
      badge: "Cuarentena",
    },
    {
      id: "almacen-waste-act",
      path: "/inventory/waste-acts",
      targetSelector: '[data-tour="inventory-waste-acts-list"]',
      title: "Emisión de Acta de Baja Oficial",
      description:
        "Genera el acta foliada de merma o destrucción para auditoría de regencia y autoridades sanitarias.",
      actionPrompt: "Genera y visualiza el acta formal de baja número AB-DEMO-0001.",
      interactiveAction: "create_waste_act",
      badge: "Acta de Baja",
    },
  ],
};

/**
 * Track 3: Regente Farmacéutico (AGEMED, Controlled Medicines, Prescription Validation)
 */
export const regenteTrainingTrack: RoleTrainingTrack = {
  id: "track-regente",
  roleCode: "regente",
  title: "Entrenamiento de Regente Farmacéutico",
  description:
    "Aprende el control estricto de psicotrópicos y estupefacientes, validación de recetas médicas y el Libro Oficial digital.",
  icon: "controlled",
  estimatedDurationMinutes: 12,
  steps: [
    {
      id: "regente-catalog-sanitary",
      path: "/catalog",
      targetSelector: '[data-tour="catalog-table"]',
      title: "Ficha Sanitaria y Marca de Controlado",
      description:
        "Verifica que cada psicotrópico o estupefaciente tenga activa la bandera de control sanitario AGEMED.",
      actionPrompt: "Revisa la clasificación del Clonazepam 2 mg con estatus de medicamento controlado.",
      interactiveAction: "view_controlled_catalog",
      badge: "AGEMED",
    },
    {
      id: "regente-sales-prescription",
      path: "/sales",
      targetSelector: '[data-tour="pos-cart"]',
      title: "Dispensación Estricta bajo Receta Médica",
      description:
        "El sistema bloquea la venta de controlados si no se registran los datos obligatorios del médico y paciente.",
      actionPrompt: "Registra la matrícula médica, centro emisor y documento del paciente para autorizar la dispensación.",
      interactiveAction: "submit_prescription",
      badge: "Receta",
    },
    {
      id: "regente-archive-rx",
      path: "/controlled",
      targetSelector: '[data-tour="controlled-prescriptions-list"]',
      title: "Archivo Digital de Recetas",
      description:
        "Consulta las recetas dispensadas con su número correlativo de folio y trazabilidad por lote.",
      actionPrompt: "Localiza el folio de receta médica recién archivado en la sucursal.",
      interactiveAction: "view_prescription_archive",
    },
    {
      id: "regente-digital-book",
      path: "/controlled/book",
      targetSelector: '[data-tour="controlled-book-table"]',
      title: "Libro Oficial de Controlados y Balance Mensual",
      description:
        "Revisa los saldos de ingresos, egresos y existencias listos para presentación formal a AGEMED o SEDES.",
      actionPrompt: "Verifica que el balance del mes refleje el descuento exacto del lote dispensado.",
      interactiveAction: "view_controlled_book",
      badge: "Libro Oficial",
    },
  ],
};

/**
 * Track 4: Encargado de Sucursal (Transfers, Staff Schedules, Cash Audits)
 */
export const encargadoTrainingTrack: RoleTrainingTrack = {
  id: "track-encargado",
  roleCode: "encargado",
  title: "Entrenamiento de Encargado de Sucursal",
  description:
    "Aprende a coordinar traspasos entre sucursales, organizar turnos semanales de personal y supervisar arqueos de caja.",
  icon: "transfer",
  estimatedDurationMinutes: 10,
  steps: [
    {
      id: "encargado-transfers-request",
      path: "/transfers",
      targetSelector: '[data-tour="transfers-list"]',
      title: "Solicitud de Traspaso Inter-Sucursal",
      description:
        "Pide reposición urgente de medicamentos al Almacén Central u otra sucursal de la cadena.",
      actionPrompt: "Crea una solicitud de traspaso de mercadería desde el almacén de despacho.",
      interactiveAction: "request_transfer",
      badge: "Traspaso",
    },
    {
      id: "encargado-staff-scheduling",
      path: "/staff",
      targetSelector: '[data-tour="staff-schedule"]',
      title: "Planificación de Turnos de Personal",
      description:
        "Asigna los horarios de trabajo y turnos de caja para asegurar la cobertura continua de la farmacia.",
      actionPrompt: "Revisa el calendario semanal y programa un turno para un cajero.",
      interactiveAction: "schedule_shift",
      badge: "Horarios",
    },
    {
      id: "encargado-cash-audit",
      path: "/cash",
      targetSelector: '[data-tour="cash-shifts-list"]',
      title: "Supervisión y Aprobación de Arqueos",
      description:
        "Revisa los turnos cerrados con diferencias o sobrantes de caja para autorizar el arqueo.",
      actionPrompt: "Aprueba el cierre de turno con justificación de la diferencia registrada.",
      interactiveAction: "approve_difference",
      badge: "Auditoría",
    },
    {
      id: "encargado-inventory-control",
      path: "/inventory",
      targetSelector: '[data-tour="inventory-warehouses"]',
      title: "Monitoreo de Almacenes de la Sucursal",
      description:
        "Supervisa los niveles generales de stock y rotación de productos en la sucursal asignada.",
      actionPrompt: "Verifica el resumen de existencias del almacén de despacho.",
      interactiveAction: "view_warehouses",
    },
  ],
};

/**
 * Track 5: Propietario / Administrador Global (KPIs, Users, Quotas, Margins)
 */
export const ownerTrainingTrack: RoleTrainingTrack = {
  id: "track-owner",
  roleCode: "owner",
  title: "Entrenamiento de Propietario / Administrador Global",
  description:
    "Aprende a monitorear la salud financiera del negocio, administrar usuarios dentro de las cuotas del plan y optimizar márgenes.",
  icon: "overview",
  estimatedDurationMinutes: 10,
  steps: [
    {
      id: "owner-dashboard-kpis",
      path: "/dashboard",
      targetSelector: '[data-tour="dashboard-kpis"]',
      title: "Tablero Ejecutivo en Tiempo Real",
      description:
        "Analiza los ingresos del día, volumen de ventas y tendencias semanales de todas tus sucursales.",
      actionPrompt: "Examina las ventas de hoy y la comparación con el mes anterior.",
      interactiveAction: "review_kpis",
      badge: "KPIs",
    },
    {
      id: "owner-user-quotas",
      path: "/users",
      targetSelector: '[data-tour="users-list"]',
      title: "Gestión de Usuarios y Límites del Plan",
      description:
        "Crea cuentas para tu equipo asignando roles y sucursales sin sobrepasar las cuotas de tu plan SaaS.",
      actionPrompt: "Verifica los cupos de usuarios disponibles e inicia el alta de un nuevo colaborador.",
      interactiveAction: "create_user",
      badge: "Usuarios",
    },
    {
      id: "owner-branches-plan",
      path: "/branches",
      landingPath: "/users",
      targetSelector: '[data-tour="branches-list"]',
      title: "Sucursales Habilitadas y Cajas Activas",
      description:
        "Supervisa el estado de cada punto de venta y las capacidades contratadas en tu suscripción.",
      actionPrompt: "Revisa las sucursales conectadas y las cajas registradoras en servicio.",
      interactiveAction: "check_quotas",
      badge: "Suscripción",
    },
    {
      id: "owner-margin-analytics",
      path: "/analytics",
      targetSelector: '[data-tour="analytics-cards"]',
      title: "Matriz ABC y Rentabilidad por Medicamento",
      description:
        "Identifica los productos estrella que representan el 80% de tus ventas y optimiza tus márgenes de ganancia.",
      actionPrompt: "Consulta la clasificación ABC de productos y los reportes de margen comercial.",
      interactiveAction: "review_analytics",
      badge: "Rentabilidad",
    },
  ],
};

/**
 * Pathname where a step's target lives, as `usePathname` reports it (no query string or hash).
 */
export function stepPathname(step: Pick<TrainingStep, "path" | "landingPath">): string {
  return step.landingPath ?? (step.path.split(/[?#]/)[0] || "/");
}

function hasDynamicLanding(step: Pick<TrainingStep, "landingPath">): boolean {
  return Boolean(step.landingPath && /\[[^/]+\]/.test(step.landingPath));
}

/**
 * Whether `pathname` is where the step's target lives. Landing paths may contain `[param]`
 * segments (for example `/sales/[saleId]`) that match any single path segment.
 */
export function stepMatchesPath(step: Pick<TrainingStep, "path" | "landingPath">, pathname: string): boolean {
  const pattern = stepPathname(step);
  if (!/\[[^/]+\]/.test(pattern)) {
    return pathname === pattern;
  }
  const source = pattern
    .split("/")
    .map((segment) => (/^\[[^/]+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}/?$`).test(pathname);
}

/**
 * Whether entering a step should navigate. Dynamic landing pages (a sale receipt) cannot be
 * reached from `path`, so a learner already on one is never sent away.
 */
export function shouldNavigateToStep(
  step: Pick<TrainingStep, "path" | "landingPath">,
  pathname: string,
): boolean {
  if (pathname === step.path) return false;
  return !(hasDynamicLanding(step) && stepMatchesPath(step, pathname));
}

export const allRoleTracks: RoleTrainingTrack[] = [
  cajeroTrainingTrack,
  almaceneroTrainingTrack,
  regenteTrainingTrack,
  encargadoTrainingTrack,
  ownerTrainingTrack,
];

/**
 * Returns the corresponding role training track, normalizing common aliases.
 */
export function getTrainingTrackForRole(roleCode: string): RoleTrainingTrack | null {
  if (!roleCode || typeof roleCode !== "string") {
    return null;
  }

  const normalized = roleCode.trim().toLowerCase();

  switch (normalized) {
    case "cajero":
      return cajeroTrainingTrack;
    case "almacenero":
      return almaceneroTrainingTrack;
    case "regente":
      return regenteTrainingTrack;
    case "encargado":
      return encargadoTrainingTrack;
    case "owner":
    case "propietario":
      return ownerTrainingTrack;
    default:
      return null;
  }
}
