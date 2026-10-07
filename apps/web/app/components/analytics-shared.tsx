"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { shortDay, type WeekUnits } from "../lib/analytics";
import { planAllows } from "../lib/plan";
import { useShellSession } from "./app-shell";
import { AnalyticsNav } from "./analytics-nav";

/** How long to wait for the plan snapshot before trusting the API to enforce the plan. */
const PLAN_WAIT_MS = 4000;

function PlanRequired({ what, plan }: Readonly<{ what: string; plan: string }>) {
  return (
    <section className="panel controlled-premium" role="status">
      <p className="section-kicker">Plan {plan}</p>
      <h2>{what} requiere el plan {plan}{plan === "Premium" ? "" : " o superior"}</h2>
      <p>Tu plan actual no incluye esta funcionalidad.</p>
      <Link className="quiet-button" href="/billing">Ver planes y suscripción</Link>
    </section>
  );
}

/**
 * Page frame for every analytics screen: waits for the session and the plan snapshot so a plan without the
 * feature never fires requests that would answer 403, then renders the header, the sub-nav and the content.
 */
export function AnalyticsFrame({ kicker, title, lede, feature, plan, what, children }: Readonly<{
  kicker: string;
  title: string;
  lede: string;
  /** Plan feature the data needs; omitted for the dashboard KPIs (all plans). */
  feature?: string;
  plan?: string;
  what?: string;
  children: (context: { branches: Array<{ id: string; name: string }> }) => ReactNode;
}>) {
  const shell = useShellSession();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PLAN_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!shell) return <main className="center-state"><span className="loading-orb" />Cargando analítica…</main>;
  if (!shell.session.permissions.includes("analytics.read")) {
    return (
      <main className="center-state inventory-denied">
        <div>
          <strong>Acceso restringido</strong>
          <p>Tu sesión no tiene permiso para ver la analítica.</p>
          <Link href="/dashboard">Volver al resumen</Link>
        </div>
      </main>
    );
  }
  const planKnown = shell.subscription !== null || waited;
  const features = shell.subscription?.features;
  const locked = feature ? !planAllows(features, feature) : false;
  const branches = (shell.account?.branches ?? [])
    .filter((branch) => branch.tenantId === shell.session.tenantId)
    .map((branch) => ({ id: branch.branchId, name: branch.branchName }));

  return (
    <main className="procurement-page controlled-page">
      <header className="procurement-header no-print">
        <div>
          <p className="eyebrow">{kicker}</p>
          <h1>{title}</h1>
          <p className="procurement-lede">{lede}</p>
        </div>
      </header>
      <AnalyticsNav />
      {!planKnown ? <p className="pos-hint">Verificando tu plan…</p> : locked ? <PlanRequired what={what ?? "Esta sección"} plan={plan ?? "Profesional"} /> : children({ branches })}
    </main>
  );
}

export function PeriodFilters({ from, to, branchId, branches, onChange }: Readonly<{
  from?: string;
  to?: string;
  branchId: string;
  branches: Array<{ id: string; name: string }>;
  onChange: (next: { from?: string; to?: string; branchId?: string }) => void;
}>) {
  return (
    <section className="panel no-print">
      <div className="controlled-filters">
        {from !== undefined && to !== undefined ? (
          <>
            <label className="inventory-filter"><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => onChange({ from: event.target.value })} /></label>
            <label className="inventory-filter"><span>Hasta</span><input type="date" value={to} min={from} onChange={(event) => onChange({ to: event.target.value })} /></label>
          </>
        ) : null}
        {branches.length > 1 ? (
          <label className="inventory-filter">
            <span>Sucursal</span>
            <select value={branchId} onChange={(event) => onChange({ branchId: event.target.value })}>
              <option value="">Todas mis sucursales</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    </section>
  );
}

/** Loads a report whenever the key changes; the fetcher is intentionally not a dependency (the key describes it). */
export function useReport<T>(fetcher: () => Promise<T>, key: string, enabled = true, fallback = "No pudimos cargar el reporte."): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; key: string }>({ data: null, error: null, loading: true, key });
  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    setState((current) => ({ ...current, error: null, loading: true, key }));
    fetcher()
      .then((value) => mounted && setState({ data: value, error: null, loading: false, key }))
      .catch((reason: unknown) => mounted && setState({ data: null, error: reason instanceof Error && reason.message ? reason.message : fallback, loading: false, key }));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { data: state.data, error: state.error, loading: state.loading };
}

export function validPeriod(from: string, to: string): boolean {
  return Boolean(from && to && from <= to);
}

export function InvalidPeriod() {
  return <p className="form-error procurement-message" role="alert">Indica un período válido.</p>;
}

export function ReportState({ error, loading, empty, emptyTitle, emptyHint }: Readonly<{ error: string | null; loading: boolean; empty: boolean; emptyTitle: string; emptyHint: string }>) {
  return (
    <>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {loading && !error ? <p className="pos-hint">Cargando…</p> : null}
      {empty && !loading && !error ? (
        <div className="procurement-empty">
          <span className="empty-symbol">✦</span>
          <h3>{emptyTitle}</h3>
          <p>{emptyHint}</p>
        </div>
      ) : null}
    </>
  );
}

export function Kpi({ label, value, hint, warn }: Readonly<{ label: string; value: string; hint?: string; warn?: boolean }>) {
  return (
    <article className={`analytics-kpi${warn ? " is-warn" : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

/** Weekly units: solid line for the 8-week history, dashed line for the forecast (same SVG language as the dashboard trend). */
export function ForecastChart({ history, forecast }: Readonly<{ history: WeekUnits[]; forecast: WeekUnits[] }>) {
  const width = 480;
  const height = 180;
  const pad = 14;
  const all = [...history, ...forecast];
  const max = Math.max(...all.map((point) => point.units), 1);
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(all.length - 1, 1);
  const y = (units: number) => height - pad - (units / max) * (height - pad * 2);
  const actual = history.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.units)}`).join(" ");
  // The forecast line starts at the last real point so both lines connect.
  const projected = [history.at(-1), ...forecast]
    .map((point, index) => (point ? `${index === 0 ? "M" : "L"} ${x(history.length - 1 + index)} ${y(point.units)}` : ""))
    .join(" ");
  const first = all[0]?.weekStart;
  const last = all.at(-1)?.weekStart;
  return (
    <figure className="analytics-chart">
      <div className="ax-legend"><span><i className="is-indigo" />Ventas semanales (u. base)</span><span><i className="is-green" />Pronóstico</span></div>
      <svg aria-label={`Demanda semanal, historial y pronóstico, del ${first ?? ""} al ${last ?? ""}`} role="img" viewBox={`0 0 ${width} ${height}`}>
        <path className="analytics-chart-actual" d={actual} />
        {forecast.length ? <path className="analytics-chart-forecast" d={projected} /> : null}
      </svg>
      <figcaption><span>{first ? `Semana del ${shortDay(first)}` : ""}</span><span>{last ? `Semana del ${shortDay(last)}` : ""}</span></figcaption>
    </figure>
  );
}
