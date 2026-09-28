"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accountProfile, type AccountProfile } from "../lib/account";
import { canViewCatalog } from "../lib/catalog-access";
import { listInventoryAlerts } from "../lib/inventory";
import { daysUntil, formatDate, statusLabels, subscriptionSummary, type SubscriptionSummary } from "../lib/saas";
import { currentSession, logout, type AuthSession } from "../lib/session";
import { NavIcon, type NavIconName } from "./nav-icon";

interface NavigationItem {
  label: string;
  icon: NavIconName;
  href?: string;
  permissions?: readonly string[];
}

const navigation: NavigationItem[] = [
  { label: "Resumen", icon: "overview" },
  { label: "Catálogo", icon: "catalog", href: "/catalog", permissions: ["catalog.manage", "sales.confirm"] },
  { label: "Inventario", icon: "inventory", href: "/inventory", permissions: ["inventory.manage"] },
  { label: "Reporte global", icon: "report", href: "/inventory/report", permissions: ["inventory.report.global"] },
  { label: "Compras", icon: "procurement", href: "/procurement", permissions: ["inventory.manage"] },
  { label: "Ventas y caja", icon: "cash", href: "/cash", permissions: ["cash.manage"] },
  { label: "Ventas POS", icon: "sales", href: "/sales", permissions: ["sales.confirm"] },
  { label: "Auditoría", icon: "audit", href: "/audit", permissions: ["audit.read"] },
  { label: "Usuarios", icon: "users", href: "/users", permissions: ["users.manage"] },
  { label: "Suscripción", icon: "billing", href: "/billing", permissions: ["billing.manage"] },
  { label: "Mi cuenta", icon: "account", href: "/account" }
];

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function DashboardShell() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [expiryAlerts, setExpiryAlerts] = useState<{ expired: number; expiring: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((value) => {
        if (mounted) {
          setSession(value);
          // El aviso es informativo: si falla, el panel sigue funcionando.
          subscriptionSummary().then((summary) => mounted && setSubscription(summary)).catch(() => undefined);
          accountProfile().then((profile) => mounted && setAccount(profile)).catch(() => undefined);
          if (value.permissions.includes("inventory.manage")) {
            listInventoryAlerts(false)
              .then((result) => mounted && setExpiryAlerts({
                expired: result.items.filter((item) => item.alertType === "EXPIRED").length,
                expiring: result.items.filter((item) => item.alertType === "EXPIRING").length
              }))
              .catch(() => undefined);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setSessionError(true);
          router.replace("/");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [router]);

  async function signOut(): Promise<void> {
    await logout();
    router.replace("/");
  }

  if (loading && !sessionError) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión…</main>;
  }
  if (!session) {
    return null;
  }

  const canViewCatalogModule = canViewCatalog(session.permissions);
  const canManageInventory = session.permissions.includes("inventory.manage");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div>
            <strong>FARMAXIA</strong>
            <span>operación inteligente</span>
          </div>
        </div>
        <div className="workspace-switcher">
          <span className="status-dot" />
          <div>
            <small>Espacio activo</small>
            <strong>{account?.tenantName ?? shortId(session.tenantId)}</strong>
          </div>
          <span className="switcher-arrow">⌄</span>
        </div>
        <nav className="main-nav" aria-label="Navegación principal">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => {
            const content = <><span className="nav-icon"><NavIcon name={item.icon} /></span><span>{item.label}</span></>;
            if (!item.href) {
              return <span aria-current="page" className="nav-item is-active" key={item.label}>{content}</span>;
            }
            if (!item.permissions || item.permissions.some((permission) => session.permissions.includes(permission))) {
              return <Link className="nav-item" href={item.href} key={item.label}>{content}</Link>;
            }
            return <button className="nav-item" disabled key={item.label} type="button">{content}<small>Sin acceso</small></button>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="secure-badge"><span>●</span> Sesión protegida</div>
          <button className="logout-button" onClick={signOut} type="button">Cerrar sesión <NavIcon name="logout" /></button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Panel de control</p>
            <h1>Una operación más clara.</h1>
          </div>
          <div className="context-pill">
            <span className="status-dot" />
            <div><small>Sucursal activa</small><strong>{account?.branchName ?? shortId(session.branchId)}</strong></div>
          </div>
        </header>
        {subscription ? <SubscriptionNotice subscription={subscription} canManage={session.permissions.includes("billing.manage")} /> : null}
        {expiryAlerts && expiryAlerts.expired + expiryAlerts.expiring > 0 ? (
          <div className={`subscription-notice ${expiryAlerts.expired ? "notice-danger" : "notice-warning"}`} role="status">
            <span className="notice-badge">Vencimientos</span>
            <p>
              {expiryAlerts.expired ? `${expiryAlerts.expired} ${expiryAlerts.expired === 1 ? "lote vencido" : "lotes vencidos"} con stock` : ""}
              {expiryAlerts.expired && expiryAlerts.expiring ? " y " : ""}
              {expiryAlerts.expiring ? `${expiryAlerts.expiring} ${expiryAlerts.expiring === 1 ? "lote vence" : "lotes vencen"} en los próximos 30 días` : ""}.
            </p>
            <Link className="quiet-button" href="/inventory">Revisar inventario</Link>
          </div>
        ) : null}
        <section className="welcome-card">
          <div>
            <p className="section-kicker">Sesión validada</p>
            <h2>Tu espacio está listo para crecer.</h2>
            <p>La identidad y los permisos vienen directamente de la API. Los módulos se habilitarán a medida que cada flujo de negocio quede verificado.</p>
          </div>
          <div className="welcome-orbit" aria-hidden="true"><span /><span /><span /></div>
        </section>
        <section className="metrics-grid" aria-label="Estado de la plataforma">
          <article className="metric-card accent-blue"><span className="metric-index">01</span><p>Contexto</p><strong>Validado</strong><small>Tenant y sucursal activos</small></article>
          <article className="metric-card accent-orange"><span className="metric-index">02</span><p>Permisos efectivos</p><strong>{session.permissions.length}</strong><small>Devueltos por la sesión</small></article>
          <article className="metric-card accent-green"><span className="metric-index">03</span><p>Accesos disponibles</p><strong>{[canViewCatalogModule, canManageInventory].filter(Boolean).length}</strong><small>Catálogo e inventario según tu permiso</small></article>
        </section>
        <section className="lower-grid">
          <article className="panel permissions-panel">
            <div className="panel-heading"><div><p className="section-kicker">Autorización</p><h3>Permisos de esta sesión</h3></div><span className="panel-count">{session.permissions.length.toString().padStart(2, "0")}</span></div>
            {session.permissions.length ? <div className="permission-list">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div> : <p className="empty-copy">No hay permisos efectivos para mostrar.</p>}
          </article>
          <article className="panel roadmap-panel">
            <div className="panel-heading"><div><p className="section-kicker">Operación</p><h3>Accesos disponibles</h3></div><span className="sparkle">✦</span></div>
            {canViewCatalogModule ? <Link className="roadmap-row" href="/catalog"><span className="roadmap-number">01</span><div><strong>Catálogo farmacéutico</strong><small>Consulta productos y sus presentaciones</small></div><span className="roadmap-state">Abrir</span></Link> : null}
            {canManageInventory ? <Link className="roadmap-row" href="/inventory"><span className="roadmap-number">02</span><div><strong>Inventario operativo</strong><small>Alertas de vencimiento, cuarentena y mermas</small></div><span className="roadmap-state">Abrir</span></Link> : null}
            {!canViewCatalogModule && !canManageInventory ? <p className="empty-copy">No tienes acceso a catálogo ni inventario con esta sesión.</p> : null}
          </article>
        </section>
      </main>
    </div>
  );
}

function SubscriptionNotice({ subscription, canManage }: Readonly<{ subscription: SubscriptionSummary; canManage: boolean }>) {
  const trialDays = daysUntil(subscription.trialEndsAt);
  let tone = "info";
  let message: string;
  if (subscription.status === "TRIALING") {
    message = trialDays !== null && trialDays > 0
      ? `Te quedan ${trialDays} ${trialDays === 1 ? "día" : "días"} de prueba del plan ${subscription.plan.name}.`
      : "Tu periodo de prueba terminó.";
  } else if (subscription.status === "PAST_DUE") {
    tone = "warning";
    message = `Tu pago está vencido. Tienes hasta el ${formatDate(subscription.graceEndsAt)} para regularizarlo.`;
  } else if (subscription.status === "SUSPENDED") {
    tone = "danger";
    message = "Tu suscripción está suspendida: los módulos están bloqueados hasta registrar el pago.";
  } else if (subscription.openInvoices > 0) {
    message = `Plan ${subscription.plan.name} activo. Tienes ${subscription.openInvoices} comprobante(s) por pagar.`;
  } else {
    return null;
  }
  return (
    <div className={`subscription-notice notice-${tone}`} role="status">
      <span className="notice-badge">{statusLabels[subscription.status]}</span>
      <p>{message}</p>
      {canManage ? <Link className="quiet-button" href="/billing">Ver suscripción</Link> : null}
    </div>
  );
}
