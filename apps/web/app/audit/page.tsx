"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatDate, listAuditEvents, type AuditLogPage } from "../lib/saas";
import { currentSession, type AuthSession } from "../lib/session";

const pageSize = 25;

// Nombres legibles de las acciones más comunes; el resto se muestra con su código.
const actionLabels: Record<string, string> = {
  "tenant.registered": "Farmacia registrada",
  "saas.payment.submitted": "Pago de suscripción enviado"
};

export default function AuditPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [filters, setFilters] = useState({ action: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (nextFilters: typeof filters, nextOffset: number) => {
    setError(null);
    try {
      setPage(await listAuditEvents({ ...nextFilters, offset: nextOffset, limit: pageSize }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar la bitácora.");
    }
  }, []);

  useEffect(() => {
    currentSession()
      .then(async (value) => {
        setSession(value);
        if (value.permissions.includes("audit.read")) {
          await load({ action: "", from: "", to: "" }, 0);
        }
      })
      .catch(() => window.location.assign("/"))
      .finally(() => setLoading(false));
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setApplied(filters);
    setOffset(0);
    void load(filters, 0);
  }

  function go(nextOffset: number): void {
    setOffset(nextOffset);
    void load(applied, nextOffset);
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando bitácora…</main>;
  }
  if (!session) return null;
  if (!session.permissions.includes("audit.read")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para consultar la auditoría.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="eyebrow">Auditoría</p>
          <h1>Quién hizo qué, y cuándo.</h1>
          <p className="inventory-lede">Cada operación queda registrada y no se puede modificar ni borrar. Aquí ves la actividad de tu sucursal.</p>
        </div>
      </header>

      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}

      <form className="inventory-toolbar audit-toolbar" onSubmit={submit} aria-label="Filtros de auditoría">
        <label className="inventory-filter"><span>Acción</span><input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="Ej. sale, payment, inventory" /></label>
        <label className="inventory-filter"><span>Desde</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className="inventory-filter"><span>Hasta</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <button className="search-button" type="submit">Filtrar</button>
        <div className="inventory-summary"><strong>{page?.total ?? 0}</strong><span>eventos</span></div>
      </form>

      {page ? (
        <p className="retention-note">
          {page.retentionDays === null
            ? "Tu plan permite consultar todo el historial."
            : `Tu plan permite consultar los últimos ${page.retentionDays} días (desde el ${formatDate(page.visibleSince)}). El historial completo se conserva y aparece al subir de plan.`}
        </p>
      ) : null}

      <section className="inventory-table-panel panel">
        <div className="panel-heading"><div><p className="section-kicker">Registro inmutable</p><h2>Eventos</h2></div><span className="panel-count">{(page?.items.length ?? 0).toString().padStart(2, "0")}</span></div>
        {page?.items.length ? (
          <div className="audit-list">
            <div className="audit-head"><span>Fecha</span><span>Acción</span><span>Registro</span><span>Usuario</span></div>
            {page.items.map((item) => (
              <article className="audit-row" key={item.id}>
                <span className="audit-date">{formatDate(item.occurredAt, true)}</span>
                <span className="audit-action"><strong>{actionLabels[item.action] ?? item.action}</strong>{actionLabels[item.action] ? <small>{item.action}</small> : null}</span>
                <span className="audit-entity"><strong>{item.entityType}</strong><small>{item.entityId.slice(0, 8)}{item.entityId.length > 8 ? "…" : ""}</small></span>
                <span className="audit-actor">{item.actorName ?? "—"}</span>
                {Object.keys(item.payload ?? {}).length ? (
                  <button className="row-action audit-toggle" onClick={() => setExpanded(expanded === item.id ? null : item.id)} type="button" aria-expanded={expanded === item.id}>
                    {expanded === item.id ? "Ocultar detalle" : "Ver detalle"}
                  </button>
                ) : null}
                {expanded === item.id ? <pre className="audit-payload">{JSON.stringify(item.payload, null, 2)}</pre> : null}
              </article>
            ))}
          </div>
        ) : <div className="inventory-state inventory-empty-inline"><span className="empty-symbol">✓</span><h3>No hay eventos para estos filtros.</h3><p>Prueba con otras fechas o sin filtro de acción.</p></div>}
      </section>

      {page && page.total > pageSize ? (
        <div className="inventory-pagination">
          <button className="quiet-button" disabled={offset === 0} onClick={() => go(Math.max(0, offset - pageSize))} type="button">← Anterior</button>
          <span>{offset + 1}–{Math.min(offset + page.items.length, page.total)} de {page.total}</span>
          <button className="quiet-button" disabled={offset + pageSize >= page.total} onClick={() => go(offset + pageSize)} type="button">Siguiente →</button>
        </div>
      ) : null}
    </main>
  );
}
