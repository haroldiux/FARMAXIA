"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBob, formatDate, statusLabels, type SubscriptionStatus } from "../../lib/saas";
import { platformOverview, runBillingCycle, type PlatformOverview } from "../../lib/platform";

const statusOrder: SubscriptionStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED"];

export default function PlatformOverviewPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load(): Promise<void> {
    try {
      setOverview(await platformOverview());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar el resumen.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runCycle(): Promise<void> {
    setRunning(true);
    setError(null);
    try {
      const result = await runBillingCycle();
      setNotice(`Ciclo ejecutado: ${result.invoicesIssued} comprobante(s) emitido(s), ${result.movedToPastDue} en mora, ${result.suspended} suspendida(s).`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos ejecutar el ciclo.");
    } finally {
      setRunning(false);
    }
  }

  const total = overview ? Object.values(overview.tenantsByStatus).reduce((sum, value) => sum + value, 0) : 0;

  return (
    <>
      <header className="topbar">
        <div><p className="eyebrow">Plataforma</p><h1>Así va el negocio.</h1></div>
        <button className="quiet-button" disabled={running} onClick={() => void runCycle()} type="button">{running ? "Ejecutando…" : "Ejecutar ciclo de cobro"}</button>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      {overview ? (
        <>
          <section className="metrics-grid platform-metrics" aria-label="Indicadores">
            <article className="metric-card accent-blue"><p>Farmacias con suscripción</p><strong>{total}</strong><small>{overview.tenantsByStatus.TRIALING ?? 0} en prueba</small></article>
            <article className="metric-card accent-green"><p>Ingreso mensual recurrente</p><strong>{formatBob(overview.monthlyRecurringBob)}</strong><small>Planes activos y en mora</small></article>
            <article className="metric-card accent-orange"><p>Pagos por revisar</p><strong>{overview.pendingPayments}</strong><small>{overview.openInvoices.count} comprobante(s) abiertos · {formatBob(overview.openInvoices.amountBob)}</small></article>
          </section>

          <section className="lower-grid">
            <article className="panel">
              <div className="panel-heading"><div><p className="section-kicker">Suscripciones</p><h3>Por estado</h3></div></div>
              <div className="status-breakdown">
                {statusOrder.map((status) => (
                  <Link className="status-breakdown-row" href={`/platform/tenants?status=${status}`} key={status}>
                    <span className={`subscription-badge badge-${status.toLowerCase()}`}>{statusLabels[status]}</span>
                    <strong>{overview.tenantsByStatus[status] ?? 0}</strong>
                  </Link>
                ))}
              </div>
            </article>
            <article className="panel">
              <div className="panel-heading"><div><p className="section-kicker">Altas</p><h3>Últimas farmacias</h3></div>{overview.pendingPayments ? <Link className="row-action" href="/platform/payments">Revisar pagos</Link> : null}</div>
              {overview.recentRegistrations.length ? overview.recentRegistrations.map((tenant) => (
                <Link className="roadmap-row platform-link-row" href={`/platform/tenants/${tenant.tenantId}`} key={tenant.tenantId}>
                  <span className="roadmap-number">{tenant.name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{tenant.name}</strong><small>{formatDate(tenant.createdAt)}</small></div>
                  <span className="roadmap-state">{tenant.planName}</span>
                </Link>
              )) : <p className="empty-copy">Aún no hay farmacias registradas.</p>}
            </article>
          </section>
        </>
      ) : <div className="inventory-state"><span className="loading-orb" />Cargando…</div>}
    </>
  );
}
