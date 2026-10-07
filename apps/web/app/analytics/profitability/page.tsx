"use client";

import { useState } from "react";
import { AnalyticsFrame, InvalidPeriod, Kpi, PeriodFilters, ReportState, useReport, validPeriod } from "../../components/analytics-shared";
import { downloadProfitabilityCsv, errorMessage, getProfitability, groupLabels, monthStartIso, money, percent, todayIso, type ProfitabilityGroup } from "../../lib/analytics";

const groups: ProfitabilityGroup[] = ["product", "laboratory", "branch"];

function Profitability({ branches }: Readonly<{ branches: Array<{ id: string; name: string }> }>) {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState("");
  const [groupBy, setGroupBy] = useState<ProfitabilityGroup>("product");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const valid = validPeriod(from, to);
  const report = useReport(() => getProfitability({ from, to, branchId: branchId || undefined, groupBy }), `prof|${from}|${to}|${branchId}|${groupBy}`, valid, "No pudimos cargar la rentabilidad.");
  const data = report.data;

  async function exportCsv(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadProfitabilityCsv({ from, to, branchId: branchId || undefined, groupBy });
    } catch (reason) {
      setDownloadError(errorMessage(reason, "No pudimos exportar el CSV."));
    } finally {
      setDownloading(false);
    }
  }

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
            <div><p className="section-kicker">Ingresos netos, costo y margen</p><h2>Rentabilidad por {groupLabels[groupBy].toLowerCase()}</h2></div>
            <button className="quiet-button no-print" disabled={downloading || !data?.rows.length} onClick={() => void exportCsv()} type="button">{downloading ? "Exportando…" : "Descargar CSV"}</button>
          </div>
          <div className="analytics-tabs no-print" role="group" aria-label="Agrupar por">
            {groups.map((group) => <button aria-pressed={groupBy === group} key={group} onClick={() => setGroupBy(group)} type="button">{groupLabels[group]}</button>)}
          </div>
          {downloadError ? <p className="form-error procurement-message" role="alert">{downloadError}</p> : null}
          <ReportState error={report.error} loading={report.loading} empty={Boolean(data) && !data?.rows.length} emptyTitle="Sin ventas en este período." emptyHint="Elige otro rango de fechas." />
          {data?.rows.length ? (
            <>
              <div className="analytics-kpis">
                <Kpi label="Ingresos netos" value={money(data.totals.revenueBob)} />
                <Kpi label="Costo" value={money(data.totals.costBob)} />
                <Kpi label="Margen" value={data.totals.marginBob === null ? "—" : money(data.totals.marginBob)} hint={`Margen ${percent(data.totals.marginPercent)}`} />
                <Kpi label="Sin costo conocido" value={money(data.totals.uncostedRevenueBob)} hint="Excluido del margen" warn={Number(data.totals.uncostedRevenueBob) > 0} />
              </div>
              <div className="controlled-table-wrap">
                <table className="invoice-table controlled-table controlled-numeric">
                  <thead><tr><th>{groupLabels[groupBy]}</th><th>Unidades</th><th>Ingresos netos</th><th>Costo</th><th>Margen</th><th>Margen %</th></tr></thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.name}{Number(row.estimatedShare) > 0 ? <span className="analytics-estimated" title={`${row.estimatedShare} % del ingreso usa el costo promedio actual`}>estimado {percent(row.estimatedShare)}</span> : null}</td>
                        <td>{row.units.toLocaleString("es-BO")}</td>
                        <td>{money(row.revenueBob)}</td>
                        <td>{money(row.costBob)}</td>
                        <td>{row.marginBob === null ? "—" : money(row.marginBob)}</td>
                        <td>{percent(row.marginPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <p className="field-hint">El costo sale de lo registrado en cada venta. En ventas anteriores al registro de costo se usa el costo promedio actual y la fila se marca como estimada.</p>
        </section>
      )}
    </>
  );
}

/** Profitability by product, laboratory or branch with CSV export (analytics.read + analytics.profitability). */
export default function AnalyticsProfitabilityPage() {
  return (
    <AnalyticsFrame kicker="Analítica · Rentabilidad" title="Rentabilidad." lede="Margen y margen porcentual por producto, laboratorio o sucursal." feature="analytics.profitability" plan="Profesional" what="La rentabilidad">
      {({ branches }) => <Profitability branches={branches} />}
    </AnalyticsFrame>
  );
}
