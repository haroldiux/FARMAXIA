"use client";

import { useEffect, useState } from "react";
import { ControlledDenied, ControlledHeader, PremiumRequired, formatDay, useControlledAccess } from "../../components/controlled-shared";
import { ControlledNav } from "../../components/controlled-nav";
import {
  currentMonth,
  downloadControlledBookCsv,
  getControlledBook,
  isPlanRestricted,
  movementTypeLabel,
  type ControlledBook
} from "../../lib/controlled";

/** Libro de controlados del mes: líneas cronológicas, imprimible y exportable a CSV. */
export default function ControlledBookPage() {
  const access = useControlledAccess();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ControlledBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (access.status !== "ready" || !/^\d{4}-\d{2}$/.test(month)) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    getControlledBook(month)
      .then((value) => {
        if (!mounted) return;
        setRestricted(false);
        setData(value);
      })
      .catch((reason) => {
        if (!mounted) return;
        setData(null);
        if (isPlanRestricted(reason)) setRestricted(true);
        else setError(reason instanceof Error ? reason.message : "No pudimos cargar el libro.");
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [access.status, month]);

  async function downloadCsv(): Promise<void> {
    setDownloading(true);
    setError(null);
    try {
      await downloadControlledBookCsv(month);
    } catch (reason) {
      if (isPlanRestricted(reason)) setRestricted(true);
      else setError(reason instanceof Error ? reason.message : "No pudimos descargar el CSV.");
    } finally {
      setDownloading(false);
    }
  }

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando libro…</main>;
  if (access.status === "denied") return <ControlledDenied />;

  const canExport = access.session.permissions.includes("controlled.book.export");

  return (
    <main className="procurement-page controlled-page controlled-book-page">
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <ControlledHeader kicker="Controlados · Libro" title="Libro de medicamentos controlados." lede="Movimientos del mes en orden cronológico, con la receta asociada a cada dispensación. Formato provisional hasta confirmar el modelo oficial." />
      <ControlledNav />
      {restricted ? <PremiumRequired what="El libro de controlados" /> : (
        <>
          {error ? <p className="form-error procurement-message no-print" role="alert">{error}</p> : null}
          <section className="panel no-print">
            <div className="controlled-filters">
              <label className="inventory-filter"><span>Mes</span><input type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value)} /></label>
              <button className="primary-button" disabled={!data} onClick={() => window.print()} type="button">Imprimir<span aria-hidden="true">⎙</span></button>
              {canExport ? <button className="quiet-button" disabled={downloading} onClick={() => void downloadCsv()} type="button">{downloading ? "Descargando…" : "Descargar CSV"}</button> : null}
            </div>
          </section>

          <section className="panel controlled-book-sheet">
            <div className="panel-heading">
              <div><p className="section-kicker">Libro de controlados</p><h2>Período {month}</h2></div>
              <span className="panel-count no-print">{(data?.lines.length ?? 0).toString().padStart(2, "0")}</span>
            </div>
            {loading && !data ? <p className="pos-hint">Cargando…</p> : null}
            {data ? (
              <>
                {data.openings.length ? (
                  <>
                    <h3 className="controlled-subtitle">Saldos iniciales (unidades base)</h3>
                    <ul className="controlled-openings">
                      {data.openings.map((opening) => <li key={opening.productId}><span>{opening.productName}</span><strong>{opening.openingBase}</strong></li>)}
                    </ul>
                  </>
                ) : null}
                {data.lines.length ? (
                  <div className="controlled-table-wrap">
                    <table className="invoice-table controlled-table controlled-book-table">
                      <thead><tr><th>Folio</th><th>Fecha</th><th>Producto</th><th>Lote</th><th>Almacén</th><th>Movimiento</th><th>Entrada</th><th>Salida</th><th>Saldo</th><th>Documento</th><th>Receta</th></tr></thead>
                      <tbody>
                        {data.lines.map((line) => (
                          <tr key={line.folio}>
                            <td>{line.folio}</td>
                            <td>{formatDay(line.date)}<small className="controlled-sub">{new Date(line.occurredAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</small></td>
                            <td>{line.productName}{line.presentationName ? <small className="controlled-sub">{line.presentationName}</small> : null}</td>
                            <td>{line.lotCode ?? "—"}</td>
                            <td>{line.warehouseName ?? "—"}</td>
                            <td>{movementTypeLabel(line.movementType)}</td>
                            <td>{line.quantityIn || ""}</td>
                            <td>{line.quantityOut || ""}</td>
                            <td>{line.balanceBase}</td>
                            <td>{line.document?.number ?? "—"}</td>
                            <td>{line.prescription ? <>{line.prescription.folio}<small className="controlled-sub">{line.prescription.doctorName} · {line.prescription.patientName}</small></> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="procurement-empty">
                    <span className="empty-symbol">✦</span>
                    <h3>Sin movimientos de controlados en este mes.</h3>
                    <p>Elige otro mes para consultar el libro.</p>
                  </div>
                )}
              </>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
