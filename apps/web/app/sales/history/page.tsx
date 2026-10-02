"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SalesNav } from "../../components/sales-nav";
import { currentSession, type AuthSession } from "../../lib/session";
import {
  listSales,
  listSalesShifts,
  salePaymentMethodLabels,
  saleStatusLabels,
  type SaleList,
  type SaleStatus,
  type SalesShift
} from "../../lib/sales";

const PAGE_SIZE = 25;

function money(value: string): string {
  return `Bs ${Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}

/** Historial de ventas de la sucursal con filtros y acceso al detalle / recibo. */
export default function SalesHistoryPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [shifts, setShifts] = useState<SalesShift[]>([]);
  const [cashiers, setCashiers] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<SaleStatus | "">("");
  const [shiftId, setShiftId] = useState("");
  const [cashierId, setCashierId] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SaleList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRead = Boolean(session?.permissions.includes("sales.read"));

  useEffect(() => {
    currentSession().then(setSession).catch(() => window.location.assign("/"));
    listSalesShifts().then(setShifts).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await listSales({
        from,
        to,
        status,
        cashShiftId: shiftId,
        cashierId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      });
      setData(result);
      setCashiers((current) => {
        const next = { ...current };
        for (const item of result.items) next[item.cashierId] = item.cashierName ?? "Sin nombre";
        return next;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar las ventas.");
    }
  }, [from, to, status, shiftId, cashierId, page]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  function changeFilter(apply: () => void): void {
    apply();
    setPage(0);
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!canRead) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para consultar ventas.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <p className="eyebrow">Ventas · Historial</p>
          <h1>Cada venta, a la mano.</h1>
          <p className="cash-lede">Busca ventas por fecha, turno, cajero o estado. Abre una venta para ver su detalle y reimprimir el recibo no fiscal.</p>
        </div>
      </header>
      <SalesNav />
      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}

      <section className="panel sales-filters" aria-label="Filtros">
        <label className="inventory-filter"><span>Desde</span><input type="date" value={from} onChange={(event) => changeFilter(() => setFrom(event.target.value))} /></label>
        <label className="inventory-filter"><span>Hasta</span><input type="date" value={to} onChange={(event) => changeFilter(() => setTo(event.target.value))} /></label>
        <label className="inventory-filter"><span>Estado</span>
          <select value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value as SaleStatus | ""))}>
            <option value="">Todos</option>
            {(Object.keys(saleStatusLabels) as SaleStatus[]).map((value) => <option key={value} value={value}>{saleStatusLabels[value]}</option>)}
          </select>
        </label>
        <label className="inventory-filter"><span>Turno</span>
          <select value={shiftId} onChange={(event) => changeFilter(() => setShiftId(event.target.value))}>
            <option value="">Todos</option>
            {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.cashRegisterCode} · {new Date(shift.scheduledStartAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</option>)}
          </select>
        </label>
        <label className="inventory-filter"><span>Cajero</span>
          <select value={cashierId} onChange={(event) => changeFilter(() => setCashierId(event.target.value))}>
            <option value="">Todos</option>
            {Object.entries(cashiers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">Ventas</p><h2>{total} {total === 1 ? "resultado" : "resultados"}</h2></div></div>
        {data === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : data.items.length ? (
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr><th>Venta</th><th>Fecha</th><th>Cajero</th><th>Pago</th><th>Estado</th><th>Total</th><th /></tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.number}</strong></td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.cashierName ?? "—"}</td>
                    <td>{item.paymentMethods.map((method) => salePaymentMethodLabels[method]).join(" + ")}</td>
                    <td><span className={`order-status sale-${item.status.toLowerCase()}`}>{saleStatusLabels[item.status]}</span></td>
                    <td className="sales-amount">{money(item.totalBob)}{Number(item.refundedBob) > 0 ? <small className="sales-refunded"> − {money(item.refundedBob)} devuelto</small> : null}</td>
                    <td><Link className="row-action" href={`/sales/${item.id}`}>Ver detalle</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="catalog-empty"><span>✓</span><h3>No hay ventas con estos filtros.</h3><p>Prueba con otro rango de fechas o quita algún filtro.</p></div>}
        {total > PAGE_SIZE ? (
          <div className="sales-pager">
            <button className="quiet-button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">← Anterior</button>
            <span>Página {page + 1} de {lastPage + 1}</span>
            <button className="quiet-button" disabled={page >= lastPage} onClick={() => setPage((current) => current + 1)} type="button">Siguiente →</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
