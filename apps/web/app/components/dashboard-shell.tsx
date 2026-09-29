"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listInventoryAlerts } from "../lib/inventory";
import { daysUntil, formatDate, statusLabels, subscriptionSummary, type SubscriptionSummary } from "../lib/saas";
import { useShellSession } from "./app-shell";

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Contenido de la página Resumen. El sidebar lo pone el marco (app-shell). */
export function DashboardShell() {
  const shell = useShellSession();
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [expiryAlerts, setExpiryAlerts] = useState<{ expired: number; expiring: number } | null>(null);
  const session = shell?.session ?? null;
  const account = shell?.account ?? null;

  useEffect(() => {
    if (!session) return undefined;
    let mounted = true;
    // Los avisos son informativos: si fallan, el panel sigue funcionando.
    subscriptionSummary().then((summary) => mounted && setSubscription(summary)).catch(() => undefined);
    if (session.permissions.includes("inventory.manage")) {
      listInventoryAlerts(false)
        .then((result) => mounted && setExpiryAlerts({
          expired: result.items.filter((item) => item.alertType === "EXPIRED").length,
          expiring: result.items.filter((item) => item.alertType === "EXPIRING").length
        }))
        .catch(() => undefined);
    }
    return () => {
      mounted = false;
    };
  }, [session]);

  if (!session) {
    return null;
  }

  return (
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
          <article className="metric-card accent-green"><span className="metric-index">03</span><p>Próximo foco</p><strong>Catálogo</strong><small>La siguiente vista funcional</small></article>
        </section>
        <section className="lower-grid">
          <article className="panel permissions-panel">
            <div className="panel-heading"><div><p className="section-kicker">Autorización</p><h3>Permisos de esta sesión</h3></div><span className="panel-count">{session.permissions.length.toString().padStart(2, "0")}</span></div>
            {session.permissions.length ? <div className="permission-list">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div> : <p className="empty-copy">No hay permisos efectivos para mostrar.</p>}
          </article>
          <article className="panel roadmap-panel">
            <div className="panel-heading"><div><p className="section-kicker">Construcción</p><h3>Lo que sigue</h3></div><span className="sparkle">✦</span></div>
            <div className="roadmap-row"><span className="roadmap-number">01</span><div><strong>Catálogo farmacéutico</strong><small>Productos, presentaciones y precios</small></div><span className="roadmap-state">Siguiente</span></div>
            <div className="roadmap-row muted"><span className="roadmap-number">02</span><div><strong>Inventario operativo</strong><small>FEFO, reservas y vencimientos</small></div><span className="roadmap-state">Después</span></div>
          </article>
        </section>
      </main>
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
