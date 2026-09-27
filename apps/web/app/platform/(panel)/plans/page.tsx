"use client";

import { useCallback, useEffect, useState } from "react";
import { formatBob, resourceLabels } from "../../../lib/saas";
import { platformFeatures, platformPlans, updatePlan, type PlatformFeature, type PlatformPlan } from "../../../lib/platform";

function limit(value: number | null | undefined): string {
  return value === null || value === undefined ? "∞" : String(value);
}

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [features, setFeatures] = useState<PlatformFeature[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextPlans, nextFeatures] = await Promise.all([platformPlans(), platformFeatures()]);
    setPlans(nextPlans);
    setFeatures(nextFeatures);
    setPrices(Object.fromEntries(nextPlans.map((plan) => [plan.code, plan.priceMonthlyBob])));
  }, []);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar los planes."));
  }, [load]);

  async function save(plan: PlatformPlan, input: { priceMonthlyBob?: string; isPublic?: boolean }, message: string): Promise<void> {
    setBusy(plan.code);
    setError(null);
    setNotice(null);
    try {
      await updatePlan(plan.code, input);
      await load();
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos actualizar el plan.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Plataforma</p><h1>Planes.</h1></div></header>
      <p className="retention-note">Un cambio de precio aplica a los comprobantes que se emitan desde ahora; los ya emitidos conservan su monto.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      {plans === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : (
        <section className="plan-admin-grid">
          {plans.map((plan) => (
            <article className={`panel plan-admin ${plan.isPublic ? "" : "is-internal"}`} key={plan.code}>
              <div className="panel-heading">
                <div><p className="section-kicker">{plan.code}</p><h3>{plan.name}</h3></div>
                <span className="panel-count" title="Suscripciones vigentes">{plan.subscriptions}</span>
              </div>
              <p className="form-note">{plan.description}</p>
              <div className="plan-admin-limits">
                {(["branches", "cash_registers", "users"] as const).map((resource) => (
                  <div key={resource}><strong>{plan.allowsAllFeatures ? "∞" : limit(plan.quotas[resource])}</strong><span>{resourceLabels[resource]}</span></div>
                ))}
                <div><strong>{plan.auditRetentionDays ?? "∞"}</strong><span>Días de bitácora</span></div>
              </div>
              <div className="plan-admin-price">
                <label className="field"><span>Precio mensual (Bs)</span><input inputMode="decimal" value={prices[plan.code] ?? ""} onChange={(event) => setPrices({ ...prices, [plan.code]: event.target.value })} /></label>
                <button className="secondary-button" disabled={busy === plan.code || prices[plan.code] === plan.priceMonthlyBob} onClick={() => void save(plan, { priceMonthlyBob: prices[plan.code] ?? "" }, `Precio de ${plan.name}: ${formatBob(prices[plan.code] ?? "0")} al mes.`)} type="button">Guardar</button>
              </div>
              <label className="toggle-row">
                <input checked={plan.isPublic} disabled={busy === plan.code} onChange={(event) => void save(plan, { isPublic: event.target.checked }, event.target.checked ? `${plan.name} ahora aparece en el registro.` : `${plan.name} ya no aparece en el registro.`)} type="checkbox" />
                <span>Visible en el registro de farmacias</span>
              </label>
              <details className="plan-admin-features">
                <summary>{plan.allowsAllFeatures ? "Incluye todas las funcionalidades" : `${plan.features.length} funcionalidades incluidas`}</summary>
                <ul>
                  {features.map((feature) => {
                    const included = plan.allowsAllFeatures || plan.features.includes(feature.code);
                    return <li className={included ? "is-enabled" : "is-disabled"} key={feature.code}><span aria-hidden="true">{included ? "✓" : "–"}</span>{feature.name}</li>;
                  })}
                </ul>
              </details>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
