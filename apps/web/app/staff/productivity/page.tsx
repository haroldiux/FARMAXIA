"use client";

import { useEffect, useState } from "react";
import { formatDay } from "../../components/controlled-shared";
import { StaffNav } from "../../components/staff-nav";
import { PeriodPicker, StaffDenied, StaffHeader, useStaffAccess } from "../../components/staff-shared";
import { errorMessage, formatBob, getProductivity, monthStartIso, todayIso, type ProductivityReport } from "../../lib/staff";

function ProductivityTable({ from, to }: Readonly<{ from: string; to: string }>) {
  const [report, setReport] = useState<ProductivityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    getProductivity(from, to)
      .then((value) => mounted && setReport(value))
      .catch((reason) => {
        if (!mounted) return;
        setReport(null);
        setError(errorMessage(reason, "No pudimos cargar la productividad."));
      });
    return () => {
      mounted = false;
    };
  }, [from, to]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">{formatDay(from)} – {formatDay(to)}</p><h2>Productividad por vendedor</h2></div>
        <span className="panel-count">{(report?.sellers.length ?? 0).toString().padStart(2, "0")}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {!report && !error ? <p className="pos-hint">Cargando…</p> : null}
      {report && !report.sellers.length ? (
        <div className="procurement-empty">
          <span className="empty-symbol">✦</span>
          <h3>Sin ventas en este período.</h3>
          <p>Elige otro rango de fechas.</p>
        </div>
      ) : null}
      {report?.sellers.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table controlled-numeric">
            <thead>
              <tr>
                <th>Vendedor</th><th>Ventas</th><th>Venta neta</th><th>Unidades</th><th>Ticket promedio</th><th>Devoluciones</th><th>Anulaciones</th>
                {report.hoursAvailable ? <><th>Horas trabajadas</th><th>Venta por hora</th></> : null}
              </tr>
            </thead>
            <tbody>
              {report.sellers.map((seller) => (
                <tr key={seller.userId}>
                  <td>{seller.userName}</td>
                  <td>{seller.salesCount}</td>
                  <td>{formatBob(seller.netSalesBob)}</td>
                  <td>{seller.units}</td>
                  <td>{formatBob(seller.averageTicketBob)}</td>
                  <td>{seller.returnsCount}<small className="controlled-sub">{formatBob(seller.returnsBob)}</small></td>
                  <td>{seller.voidsCount}</td>
                  {report.hoursAvailable ? (
                    <>
                      <td>{seller.hoursWorked === null ? "—" : seller.hoursWorked.toFixed(2)}</td>
                      <td>{seller.salesPerHourBob === null ? "—" : formatBob(seller.salesPerHourBob)}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="field-hint">
        {report && !report.hoursAvailable
          ? "Las horas trabajadas y la venta por hora requieren el plan Profesional o superior (control de turnos)."
          : "Las horas se calculan con la entrada y salida registradas en los turnos completados."}
      </p>
    </section>
  );
}

/** Productividad por vendedor del período (staff.reports.read); disponible en todos los planes. */
export default function StaffProductivityPage() {
  const access = useStaffAccess();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando productividad…</main>;
  if (!access.session.permissions.includes("staff.reports.read")) return <StaffDenied />;

  return (
    <main className="procurement-page controlled-page">
      <StaffHeader kicker="Personal · Productividad" title="Productividad del equipo." lede="Ventas, ticket promedio, devoluciones y anulaciones de cada vendedor en el período." />
      <StaffNav />
      <section className="panel"><PeriodPicker from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} /></section>
      {from && to && from <= to ? <ProductivityTable from={from} to={to} /> : <p className="form-error procurement-message" role="alert">Indica un período válido.</p>}
    </main>
  );
}
