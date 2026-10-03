"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ControlledDenied, ControlledHeader, formatDateTime, formatDay, useControlledAccess } from "../components/controlled-shared";
import { ControlledNav } from "../components/controlled-nav";
import { listPrescriptions, type PrescriptionList } from "../lib/controlled";

const PAGE_SIZE = 20;

/** Archivo de recetas de medicamentos controlados, con filtros y paginación. */
export default function ControlledArchivePage() {
  const access = useControlledAccess();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "", q: "" });
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<PrescriptionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await listPrescriptions({ ...applied, limit: PAGE_SIZE, offset }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar las recetas.");
    } finally {
      setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => {
    if (access.status === "ready") void load();
  }, [access.status, load]);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (from && to && from > to) {
      setError("La fecha inicial no puede ser posterior a la final.");
      return;
    }
    setOffset(0);
    setApplied({ from, to, q: search.trim() });
  }

  function clearFilters(): void {
    setFrom("");
    setTo("");
    setSearch("");
    setOffset(0);
    setApplied({ from: "", to: "", q: "" });
  }

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando recetas…</main>;
  if (access.status === "denied") return <ControlledDenied />;

  const total = result?.total ?? 0;
  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="procurement-page controlled-page">
      <ControlledHeader kicker="Controlados · Recetas" title="Recetas de medicamentos controlados." lede="Cada venta de un controlado archiva su receta con el médico, el paciente y los lotes dispensados." />
      <ControlledNav />
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}

      <section className="panel">
        <form className="controlled-filters" onSubmit={applyFilters}>
          <label className="inventory-filter"><span>Desde</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="inventory-filter"><span>Hasta</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label className="inventory-filter controlled-filter-search"><span>Buscar</span><input placeholder="Folio, venta, paciente, documento o médico" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <button className="primary-button" type="submit">Filtrar</button>
          <button className="quiet-button" type="button" onClick={clearFilters}>Limpiar</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Archivo</p><h2>Recetas dispensadas</h2></div>
          <span className="panel-count">{total.toString().padStart(2, "0")}</span>
        </div>
        {loading && !result ? <p className="pos-hint">Cargando…</p> : null}
        {result && result.items.length ? (
          <div className="controlled-table-wrap">
            <table className="invoice-table controlled-table">
              <thead><tr><th>Folio</th><th>Dispensación</th><th>Venta</th><th>Médico</th><th>Paciente</th><th>Centro emisor</th><th aria-label="Detalle" /></tr></thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.folio}</strong><small className="controlled-sub">Receta del {formatDay(item.prescribedAt)}</small></td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.saleNumber}</td>
                    <td>{item.doctorName}<small className="controlled-sub">Mat. {item.doctorLicense}</small></td>
                    <td>{item.patientName}<small className="controlled-sub">{item.patientDocument}</small></td>
                    <td>{item.issuingCenter}</td>
                    <td><Link className="quiet-button" href={`/controlled/${item.id}`}>Ver detalle</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {result && !result.items.length && !loading ? (
          <div className="procurement-empty">
            <span className="empty-symbol">✦</span>
            <h3>No hay recetas para mostrar.</h3>
            <p>{applied.q || applied.from || applied.to ? "Prueba con otros filtros." : "Aparecerán aquí cuando se venda un medicamento controlado."}</p>
          </div>
        ) : null}
        {result && total > 0 ? (
          <div className="controlled-pager">
            <span>{pageStart}–{pageEnd} de {total}</span>
            <button className="quiet-button" disabled={offset === 0 || loading} type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button>
            <button className="quiet-button" disabled={offset + PAGE_SIZE >= total || loading} type="button" onClick={() => setOffset(offset + PAGE_SIZE)}>Siguiente</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
