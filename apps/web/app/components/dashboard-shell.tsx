"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listInventoryAlerts } from "../lib/inventory";
import { allModules, type Tone } from "../lib/modules";
import { daysUntil, formatDate, resourceLabels, statusLabels, subscriptionSummary, type SubscriptionSummary } from "../lib/saas";
import { useShellSession } from "./app-shell";
import { NavIcon } from "./nav-icon";

function firstName(name: string | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

function todayLabel(): string {
  const text = new Date().toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Los accesos van de a 4 por fila; los últimos se estiran para que la fila quede completa. */
function tileSpan(index: number, count: number): string {
  const remainder = count % 4;
  if (remainder === 0 || index < count - remainder) return "span-3";
  return remainder === 1 ? "span-12" : remainder === 2 ? "span-6" : "span-4";
}

const subscriptionTone: Record<SubscriptionSummary["status"], Tone> = {
  TRIALING: "sky",
  ACTIVE: "green",
  PAST_DUE: "amber",
  SUSPENDED: "orange",
  CANCELED: "indigo"
};

/** Contenido de la página Resumen en Bento Grid. El sidebar lo pone el marco (app-shell). */
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

  const modules = allModules.filter((item) => item.key !== "dashboard" && (!item.permission || session.permissions.includes(item.permission)));
  const shortcuts = modules.filter((item) => ["sales", "inventory", "catalog", "cash"].includes(item.key)).slice(0, 2);
  const canManageBilling = session.permissions.includes("billing.manage");
  const canManageInventory = session.permissions.includes("inventory.manage");

  return (
    <main className="dashboard-main">
      <section className="bento-grid" aria-label="Resumen de tu farmacia">
        <article className="bento-card is-strong tone-blue span-8 row-2 dashboard-hero">
          <div>
            <p className="bento-label">{todayLabel()}</p>
            <h1>{account ? `Hola, ${firstName(account.displayName)}.` : "Hola."} Tu farmacia, en orden.</h1>
          </div>
          <div className="hero-meta">
            <span className="hero-chip"><span className="status-dot" />{account?.tenantName ?? "Farmacia"}</span>
            <span className="hero-chip">Sucursal · {account?.branchName ?? "activa"}</span>
            <span className="hero-chip">{modules.length} {modules.length === 1 ? "módulo disponible" : "módulos disponibles"}</span>
          </div>
          {shortcuts.length ? (
            <div className="bento-actions">
              {shortcuts.map((item, index) => (
                <Link className={`bento-link ${index ? "is-ghost" : ""}`} href={item.href} key={item.key}>Ir a {item.label} ↗</Link>
              ))}
            </div>
          ) : null}
        </article>

        <SubscriptionCard canManage={canManageBilling} subscription={subscription} />

        {canManageInventory ? <ExpiryCard alerts={expiryAlerts} /> : (
          <article className="bento-card tone-lilac span-4">
            <p className="bento-label">Tu acceso</p>
            <p className="bento-value">{session.permissions.length}</p>
            <p className="bento-note">permisos activos en esta sesión.</p>
          </article>
        )}

        {modules.map((item, index) => (
          <Link className={`bento-card quick-tile tone-${item.tone} ${tileSpan(index, modules.length)}`} href={item.href} key={item.key} style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}>
            <span className="bento-icon"><NavIcon name={item.icon} /></span>
            <span aria-hidden="true" className="quick-tile-arrow">↗</span>
            <h3>{item.label}</h3>
            <p className="bento-note">{item.description}</p>
          </Link>
        ))}

        <article className="bento-card tone-sky span-5">
          <p className="bento-label">Uso de tu plan</p>
          {subscription ? (
            <>
              <h3>{subscription.plan.name}</h3>
              <div className="usage-meter">
                {subscription.usage.map((row) => {
                  const percent = row.limit ? Math.min(100, Math.round((row.used / row.limit) * 100)) : null;
                  return (
                    <div className="usage-meter-row" key={row.resource}>
                      <div><strong>{resourceLabels[row.resource] ?? row.resource}</strong><span>{row.used} de {row.limit ?? "ilimitadas"}</span></div>
                      {percent === null ? null : <div aria-hidden="true" className="meter"><span style={{ width: `${Math.max(percent, 4)}%` }} /></div>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : <p className="bento-note">Cargando el uso del plan…</p>}
        </article>

        <article className="bento-card tone-lilac span-4">
          <p className="bento-label">Seguridad de tu cuenta</p>
          <h3>{account?.displayName ?? "Tu cuenta"}</h3>
          <ul className="check-list">
            <li className={account?.twoFactorEnabled ? "" : "is-off"}>{account?.twoFactorEnabled ? "Verificación en dos pasos activa" : "Verificación en dos pasos desactivada"}</li>
            <li>{account ? `${account.branches.length} ${account.branches.length === 1 ? "sucursal habilitada" : "sucursales habilitadas"}` : "Sucursales habilitadas"}</li>
            <li>{account?.passwordChangedAt ? `Contraseña cambiada el ${formatDate(account.passwordChangedAt)}` : "Contraseña inicial sin cambiar"}</li>
          </ul>
          <div className="bento-actions"><Link className="bento-link" href="/account">Mi cuenta ↗</Link></div>
        </article>

        <article className="bento-card tone-indigo span-3">
          <p className="bento-label">Permisos</p>
          <p className="bento-value">{session.permissions.length}</p>
          <div className="chip-cloud">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div>
        </article>
      </section>
    </main>
  );
}

function SubscriptionCard({ subscription, canManage }: Readonly<{ subscription: SubscriptionSummary | null; canManage: boolean }>) {
  if (!subscription) {
    return (
      <article className="bento-card tone-green span-4">
        <p className="bento-label">Suscripción</p>
        <p className="bento-note">Cargando tu plan…</p>
      </article>
    );
  }
  const trialDays = daysUntil(subscription.trialEndsAt);
  let message: string;
  if (subscription.status === "TRIALING") {
    message = trialDays !== null && trialDays > 0 ? `Te quedan ${trialDays} ${trialDays === 1 ? "día" : "días"} de prueba.` : "Tu periodo de prueba terminó.";
  } else if (subscription.status === "PAST_DUE") {
    message = `Pago vencido. Regularízalo hasta el ${formatDate(subscription.graceEndsAt)}.`;
  } else if (subscription.status === "SUSPENDED") {
    message = "Suscripción suspendida: los módulos están bloqueados hasta registrar el pago.";
  } else if (subscription.openInvoices > 0) {
    message = `${subscription.openInvoices} ${subscription.openInvoices === 1 ? "comprobante" : "comprobantes"} por pagar.`;
  } else {
    message = "Todo al día. Sin comprobantes pendientes.";
  }
  return (
    <article className={`bento-card is-strong tone-${subscriptionTone[subscription.status]} span-4`} role="status">
      <p className="bento-label">Suscripción · {statusLabels[subscription.status]}</p>
      <h2 className="bento-value">{subscription.plan.name}</h2>
      <p className="bento-note">{message}</p>
      {canManage ? <div className="bento-actions"><Link className="bento-link" href="/billing">Ver suscripción ↗</Link></div> : null}
    </article>
  );
}

function ExpiryCard({ alerts }: Readonly<{ alerts: { expired: number; expiring: number } | null }>) {
  if (!alerts) {
    return (
      <article className="bento-card tone-amber span-4">
        <p className="bento-label">Vencimientos</p>
        <p className="bento-note">Revisando lotes…</p>
      </article>
    );
  }
  const total = alerts.expired + alerts.expiring;
  const tone: Tone = alerts.expired ? "orange" : alerts.expiring ? "amber" : "green";
  return (
    <article className={`bento-card ${total ? "is-strong" : ""} tone-${tone} span-4`} role="status">
      <p className="bento-label">Vencimientos · próximos 30 días</p>
      <p className="bento-value">{total}</p>
      <p className="bento-note">
        {total === 0 ? "Ningún lote con stock vence pronto." : null}
        {alerts.expired ? `${alerts.expired} ${alerts.expired === 1 ? "lote vencido" : "lotes vencidos"} con stock` : ""}
        {alerts.expired && alerts.expiring ? " y " : ""}
        {alerts.expiring ? `${alerts.expiring} ${alerts.expiring === 1 ? "lote por vencer" : "lotes por vencer"}` : ""}
        {total ? "." : ""}
      </p>
      <div className="bento-actions"><Link className="bento-link" href="/inventory">Revisar inventario ↗</Link></div>
    </article>
  );
}
