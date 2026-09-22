"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, type AuthSession } from "../../lib/session";
import {
  listTenantStockReport,
  type TenantStockReport
} from "../../lib/inventory";

const pageSize = 25;

export default function InventoryReportPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [report, setReport] = useState<TenantStockReport | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentSession()
      .then(setSession)
      .catch(() => window.location.assign("/"));
  }, []);

  useEffect(() => {
    if (!session?.permissions.includes("inventory.report.global")) {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);
    listTenantStockReport({ search: activeSearch, limit: pageSize, offset })
      .then((value) => { if (mounted) setReport(value); })
      .catch((reason) => { if (mounted) setError(reason instanceof Error ? reason.message : "No pudimos cargar el reporte."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session, activeSearch, offset]);

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setOffset(0);
    setActiveSearch(search.trim());
  }

  if (loading && !session) {
    return <main className="center-state"><span className="loading-orb" />Cargando reporte…</main>;
  }
  if (!session) return null;
  if (!session.permissions.includes("inventory.report.global")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para consultar reportes globales.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div><Link className="back-link" href="/dashboard">← Volver al resumen</Link><p className="eyebrow">F9 · Reporte global</p><h1>Una mirada completa al inventario.</h1><p className="inventory-lede">Consulta existencias físicas, reservas y disponibilidad de todas las sucursales del tenant sin alterar la operación.</p></div>
      </header>
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}
      <section className="inventory-toolbar" aria-label="Filtros del reporte">
        <form className="inventory-filter" onSubmit={submitSearch}><span>Buscar</span><div className="report-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sucursal, almacén o producto" /><button className="quiet-button" type="submit">Aplicar</button></div></form>
        <div className="inventory-summary"><strong>{report?.total ?? 0}</strong><span>filas encontradas</span></div>
      </section>
      {report ? <>
        <section className="metrics-grid" aria-label="Totales de inventario"><article className="metric-card accent-blue"><p>Físico</p><strong>{report.tenantTotal.physical}</strong><small>unidades base</small></article><article className="metric-card accent-orange"><p>Reservado</p><strong>{report.tenantTotal.reserved}</strong><small>unidades base</small></article><article className="metric-card accent-green"><p>Disponible</p><strong>{report.tenantTotal.available}</strong><small>físico menos reservado</small></article></section>
        <section className="inventory-table-panel panel"><div className="panel-heading"><div><p className="section-kicker">Existencias por ubicación</p><h2>Sucursal · almacén · producto · presentación</h2></div><span className="panel-count">{report.items.length.toString().padStart(2, "0")}</span></div>
          {!report.items.length ? <div className="inventory-state inventory-empty-inline"><span className="empty-symbol">✓</span><h3>No hay existencias para estos filtros.</h3><p>Prueba con otra búsqueda o revisa las sucursales habilitadas.</p></div> : <div className="inventory-alert-list"><div className="inventory-table-head"><span>Jerarquía</span><span>Físico</span><span>Reservado</span><span>Disponible</span><span /></div>{report.items.map((item) => <article className="inventory-alert-row" key={`${item.warehouseId}-${item.presentationId}`}><div className="inventory-lot"><span className="lot-avatar">{item.branchCode.slice(0, 1)}</span><div><strong>{item.productName} · {item.presentationName}</strong><small>{item.branchName} · {item.warehouseName}</small></div></div><div className="inventory-quantity"><strong>{item.physical}</strong><small>unidades base</small></div><div className="inventory-quantity"><strong>{item.reserved}</strong><small>unidades base</small></div><div className="inventory-quantity"><strong>{item.available}</strong><small>unidades base</small></div><div /> </article>)}</div>}
        </section>
        <section className="inventory-layout"><article className="panel"><div className="panel-heading"><div><p className="section-kicker">Subtotales</p><h2>Por sucursal</h2></div></div>{report.branchSubtotals.map((subtotal) => <div className="roadmap-row" key={subtotal.branchId}><div><strong>{subtotal.branchCode} · {subtotal.branchName}</strong><small>Físico {subtotal.physical} · Reservado {subtotal.reserved}</small></div><span className="roadmap-state">{subtotal.available} disponibles</span></div>)}</article></section>
        <div className="inventory-pagination"><button className="quiet-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} type="button">← Anterior</button><span>{report.total ? `${offset + 1}–${Math.min(offset + report.items.length, report.total)} de ${report.total}` : "0 resultados"}</span><button className="quiet-button" disabled={offset + pageSize >= report.total} onClick={() => setOffset(offset + pageSize)} type="button">Siguiente →</button></div>
      </> : null}
    </main>
  );
}
