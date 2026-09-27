"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatBob, formatDate, resourceLabels, statusLabels, type SubscriptionStatus } from "../../../../lib/saas";
import {
  changeTenantPlan,
  platformFeatures,
  platformPlans,
  platformTenant,
  setTenantFeature,
  setTenantStatus,
  type PlatformFeature,
  type PlatformPlan,
  type PlatformTenantDetail
} from "../../../../lib/platform";

const invoiceStatus: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Por pagar", className: "order-open" },
  PAID: { label: "Pagado", className: "order-paid" },
  VOID: { label: "Anulado", className: "order-canceled" }
};

export default function PlatformTenantPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [features, setFeatures] = useState<PlatformFeature[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [featureCode, setFeatureCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const detail = await platformTenant(tenantId);
    setTenant(detail);
    setPlanCode(detail.planCode ?? "");
  }, [tenantId]);

  useEffect(() => {
    Promise.all([load(), platformPlans().then(setPlans), platformFeatures().then(setFeatures)])
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar la farmacia."));
  }, [load]);

  async function run(action: () => Promise<void>, success: string, confirmText?: string): Promise<void> {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  if (!tenant) {
    return error ? <p className="form-error" role="alert">{error}</p> : <div className="inventory-state"><span className="loading-orb" />Cargando farmacia…</div>;
  }

  const status = tenant.status as SubscriptionStatus | null;
  const overriddenCodes = new Set(tenant.featureOverrides.map((override) => override.featureCode));

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-link" href="/platform/tenants">← Farmacias</Link>
          <p className="eyebrow">{tenant.slug}</p>
          <h1>{tenant.name}</h1>
        </div>
        {status ? <span className={`subscription-badge badge-${status.toLowerCase()} badge-large`}>{statusLabels[status] ?? status}</span> : null}
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Datos</p><h3>Farmacia</h3></div></div>
          <dl className="detail-list">
            <div><dt>Razón social</dt><dd>{tenant.legalName ?? "—"}</dd></div>
            <div><dt>NIT</dt><dd>{tenant.taxId ?? "—"}</dd></div>
            <div><dt>Responsable</dt><dd>{tenant.owner ? `${tenant.owner.displayName} · ${tenant.owner.email}` : "—"}</dd></div>
            <div><dt>Alta</dt><dd>{formatDate(tenant.createdAt)}</dd></div>
            <div><dt>Plan</dt><dd>{tenant.planName ?? "—"}</dd></div>
            {tenant.trialEndsAt ? <div><dt>Prueba hasta</dt><dd>{formatDate(tenant.trialEndsAt)}</dd></div> : null}
            {tenant.currentPeriodEnd ? <div><dt>Pagado hasta</dt><dd>{formatDate(tenant.currentPeriodEnd)}</dd></div> : null}
            {tenant.graceEndsAt ? <div><dt>Gracia hasta</dt><dd>{formatDate(tenant.graceEndsAt)}</dd></div> : null}
          </dl>
          <div className="usage-list compact">
            {tenant.usage.map((row) => (
              <div className="usage-row" key={row.resource}>
                <div><strong>{resourceLabels[row.resource] ?? row.resource}</strong><span>{row.used} de {row.limit ?? "ilimitadas"}</span></div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Acciones</p><h3>Suscripción</h3></div></div>
          {status && status !== "CANCELED" ? (
            <div className="platform-actions">
              <label className="field"><span>Plan</span>
                <select value={planCode} onChange={(event) => setPlanCode(event.target.value)}>
                  {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {Number(plan.priceMonthlyBob) > 0 ? formatBob(plan.priceMonthlyBob) : "sin costo"}</option>)}
                </select>
              </label>
              <button className="secondary-button" disabled={busy || planCode === tenant.planCode} onClick={() => void run(() => changeTenantPlan(tenantId, planCode), "Plan actualizado. El comprobante abierto se reemplazó por uno con el nuevo precio.", "¿Cambiar el plan de esta farmacia?")} type="button">Cambiar plan</button>

              <div className="platform-action-row">
                {status === "SUSPENDED"
                  ? <button className="secondary-button" disabled={busy} onClick={() => void run(() => setTenantStatus(tenantId, "REACTIVATE"), "Suscripción reactivada.")} type="button">Reactivar</button>
                  : <button className="row-action row-action-muted" disabled={busy} onClick={() => void run(() => setTenantStatus(tenantId, "SUSPEND"), "Suscripción suspendida.", "La farmacia no podrá operar hasta reactivarla. ¿Suspender?")} type="button">Suspender</button>}
                <button className="row-action row-action-danger" disabled={busy} onClick={() => void run(() => setTenantStatus(tenantId, "CANCEL"), "Suscripción cancelada.", "Cancelar es definitivo y anula los comprobantes abiertos. ¿Continuar?")} type="button">Cancelar suscripción</button>
              </div>

              <div className="addon-box">
                <p className="section-kicker">Funcionalidades extra</p>
                {tenant.featureOverrides.length ? (
                  <ul className="addon-list">
                    {tenant.featureOverrides.map((override) => (
                      <li key={override.featureCode}>
                        <span>{override.name} <em>{override.isEnabled ? "habilitada" : "bloqueada"}</em></span>
                        <button className="row-action" disabled={busy} onClick={() => void run(() => setTenantFeature(tenantId, override.featureCode, null), "Se volvió a lo que incluye el plan.")} type="button">Quitar</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="form-note">Sin extras: usa lo que incluye su plan.</p>}
                <div className="addon-add">
                  <select aria-label="Funcionalidad" value={featureCode} onChange={(event) => setFeatureCode(event.target.value)}>
                    <option value="">Elige una funcionalidad</option>
                    {features.filter((feature) => !overriddenCodes.has(feature.code)).map((feature) => <option key={feature.code} value={feature.code}>{feature.module} · {feature.name}</option>)}
                  </select>
                  <button className="secondary-button" disabled={busy || !featureCode} onClick={() => void run(() => setTenantFeature(tenantId, featureCode, true).then(() => setFeatureCode("")), "Funcionalidad habilitada como extra.")} type="button">Habilitar</button>
                </div>
              </div>
            </div>
          ) : <p className="empty-copy">La suscripción está cancelada.</p>}
        </article>
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Cobros</p><h3>Comprobantes</h3></div><Link className="row-action" href="/platform/payments">Pagos por revisar</Link></div>
          {tenant.invoices.length ? <div className="order-list">{tenant.invoices.map((invoice) => (
            <div className="order-line" key={invoice.id}>
              <span>{invoice.number} · {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}</span>
              <strong>{formatBob(invoice.amountBob)}</strong>
              <span className={`order-status ${invoiceStatus[invoice.status]?.className ?? ""}`}>{invoiceStatus[invoice.status]?.label ?? invoice.status}</span>
            </div>
          ))}</div> : <p className="empty-copy">Sin comprobantes.</p>}
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Historial</p><h3>Acciones de plataforma</h3></div></div>
          {tenant.history.length ? tenant.history.map((event, index) => (
            <div className="roadmap-row" key={`${event.occurredAt}-${index}`}>
              <div><strong>{event.action}</strong><small>{formatDate(event.occurredAt, true)} · {event.operatorName ?? "Sistema"}</small></div>
            </div>
          )) : <p className="empty-copy">Sin acciones registradas.</p>}
        </article>
      </section>
    </>
  );
}
