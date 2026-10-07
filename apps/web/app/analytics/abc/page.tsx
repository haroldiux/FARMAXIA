"use client";

import { useState } from "react";
import { AnalyticsFrame, InvalidPeriod, Kpi, PeriodFilters, ReportState, useReport, validPeriod } from "../../components/analytics-shared";
import { getAbc, monthStartIso, money, percent, todayIso } from "../../lib/analytics";

function Abc({ branches }: Readonly<{ branches: Array<{ id: string; name: string }> }>) {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState("");
  const valid = validPeriod(from, to);
  const report = useReport(() => getAbc({ from, to, branchId: branchId || undefined }), `abc|${from}|${to}|${branchId}`, valid, "No pudimos cargar la matriz ABC.");
  const data = report.data;
  return (
    <>
      <PeriodFilters from={from} to={to} branchId={branchId} branches={branches} onChange={(next) => {
        if (next.from !== undefined) setFrom(next.from);
        if (next.to !== undefined) setTo(next.to);
        if (next.branchId !== undefined) setBranchId(next.branchId);
      }} />
      {!valid ? <InvalidPeriod /> : (
        <section className="panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Por ingresos netos del período</p><h2>Clasificación ABC</h2></div>
            <span className="panel-count">{(data?.items.length ?? 0).toString().padStart(2, "0")}</span>
          </div>
          <ReportState error={report.error} loading={report.loading} empty={Boolean(data) && !data?.items.length} emptyTitle="Sin ventas en este período." emptyHint="Elige otro rango de fechas." />
          {data?.items.length ? (
            <>
              <div className="analytics-kpis">
                <Kpi label="Clase A (hasta 80 %)" value={String(data.summary.A)} hint="Productos que concentran la venta" />
                <Kpi label="Clase B (80 a 95 %)" value={String(data.summary.B)} />
                <Kpi label="Clase C (resto)" value={String(data.summary.C)} />
                <Kpi label="Venta neta total" value={money(data.totalRevenueBob)} />
              </div>
              <div className="controlled-table-wrap">
                <table className="invoice-table controlled-table controlled-numeric">
                  <thead><tr><th>Clase</th><th>Producto</th><th>Presentación</th><th>Unidades</th><th>Ingresos netos</th><th>% de la venta</th><th>% acumulado</th></tr></thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.presentationId}>
                        <td><span className={`analytics-class is-${item.class}`}>{item.class}</span></td>
                        <td>{item.productName}</td>
                        <td>{item.presentationName}</td>
                        <td>{item.units.toLocaleString("es-BO")}</td>
                        <td>{money(item.revenueBob)}</td>
                        <td>{percent(item.sharePercent)}</td>
                        <td>{percent(item.cumulativePercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <p className="field-hint">A reúne el 80 % acumulado de la venta, B el siguiente 15 % y C el 5 % restante. Las unidades se muestran en la unidad de cada presentación.</p>
        </section>
      )}
    </>
  );
}

/** ABC matrix (analytics.read + analytics.abc, Premium). */
export default function AnalyticsAbcPage() {
  return (
    <AnalyticsFrame kicker="Analítica · ABC" title="Matriz ABC." lede="Qué productos sostienen tu venta y cuáles casi no rotan." feature="analytics.abc" plan="Premium" what="La matriz ABC">
      {({ branches }) => <Abc branches={branches} />}
    </AnalyticsFrame>
  );
}
