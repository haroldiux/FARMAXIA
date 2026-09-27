"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatDate, statusLabels, type SubscriptionStatus } from "../../../lib/saas";
import { platformTenants, type PlatformTenant } from "../../../lib/platform";

function nextDate(tenant: PlatformTenant): string {
  if (tenant.status === "TRIALING") return `Prueba hasta ${formatDate(tenant.trialEndsAt)}`;
  if (tenant.status === "PAST_DUE") return `Gracia hasta ${formatDate(tenant.graceEndsAt)}`;
  if (tenant.currentPeriodEnd) return `Pagado hasta ${formatDate(tenant.currentPeriodEnd)}`;
  return "—";
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<PlatformTenant[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextSearch: string, nextStatus: string) => {
    setError(null);
    try {
      setTenants(await platformTenants(nextSearch, nextStatus));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar las farmacias.");
    }
  }, []);

  useEffect(() => {
    const initialStatus = new URLSearchParams(window.location.search).get("status") ?? "";
    setStatus(initialStatus);
    void load("", initialStatus);
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load(search, status);
  }

  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Plataforma</p><h1>Farmacias.</h1></div></header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form className="inventory-toolbar" onSubmit={submit} aria-label="Filtros de farmacias">
        <label className="inventory-filter"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o identificador" /></label>
        <label className="inventory-filter"><span>Estado</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); void load(search, event.target.value); }}>
            <option value="">Todos</option>
            {(Object.keys(statusLabels) as SubscriptionStatus[]).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </select>
        </label>
        <button className="search-button" type="submit">Buscar</button>
        <div className="inventory-summary"><strong>{tenants?.length ?? 0}</strong><span>farmacias</span></div>
      </form>

      <section className="panel platform-table-panel">
        {tenants === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : tenants.length ? (
          <div className="platform-table" role="table" aria-label="Farmacias">
            <div className="platform-row platform-row-head" role="row"><span role="columnheader">Farmacia</span><span role="columnheader">Plan</span><span role="columnheader">Estado</span><span role="columnheader">Próxima fecha</span><span role="columnheader">Cobros</span></div>
            {tenants.map((tenant) => (
              <Link className="platform-row" href={`/platform/tenants/${tenant.tenantId}`} key={tenant.tenantId} role="row">
                <span role="cell" className="platform-cell-main"><strong>{tenant.name}</strong><small>{tenant.slug} · alta {formatDate(tenant.createdAt)}</small></span>
                <span role="cell">{tenant.planName ?? "—"}</span>
                <span role="cell">{tenant.status ? <span className={`subscription-badge badge-${tenant.status.toLowerCase()}`}>{statusLabels[tenant.status as SubscriptionStatus] ?? tenant.status}</span> : "—"}</span>
                <span role="cell">{nextDate(tenant)}</span>
                <span role="cell">{tenant.pendingPayments ? <span className="order-status order-partially_received">{tenant.pendingPayments} por revisar</span> : tenant.openInvoices ? `${tenant.openInvoices} abierto(s)` : "Al día"}</span>
              </Link>
            ))}
          </div>
        ) : <div className="inventory-state inventory-empty-inline"><span className="empty-symbol">✓</span><h3>No hay farmacias con estos filtros.</h3><p>Prueba otra búsqueda.</p></div>}
      </section>
    </>
  );
}
