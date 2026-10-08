"use client";

import { useState } from "react";
import { AnalyticsFrame, InvalidPeriod, PeriodFilters, ReportState, useReport, validPeriod } from "../../components/analytics-shared";
import { baseQty, dayCount, getRotation, money, shortDay, todayIso } from "../../lib/analytics";

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return todayIso(date);
}

function Rotation({ branches }: Readonly<{ branches: Array<{ id: string; name: string }> }>) {
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState("");
  const valid = validPeriod(from, to);
  const report = useReport(() => getRotation({ from, to, branchId: branchId || undefined }), `rot|${from}|${to}|${branchId}`, valid, "No pudimos cargar la rotación.");
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
            <div><p className="section-kicker">{data ? `${shortDay(data.from)} – ${shortDay(data.to)} · ${data.days} días` : "Período"}</p><h2>Rotación y días de inventario</h2></div>
            <span className="panel-count">{(data?.items.length ?? 0).toString().padStart(2, "0")}</span>
          </div>
          <ReportState error={report.error} loading={report.loading} empty={Boolean(data) && !data?.items.length} emptyTitle="Sin movimiento ni existencias." emptyHint="Elige otro rango de fechas." />
          {data?.items.length ? (
            <div className="controlled-table-wrap">
              <table className="invoice-table controlled-table controlled-numeric">
                <thead><tr><th>Producto</th><th>Vendido</th><th>Promedio diario</th><th>Disponible</th><th>Días de inventario</th><th>Costo de lo vendido</th><th>Valor en stock</th><th>Rotación</th></tr></thead>
                <tbody>
                  {data.items.map((item) => {
                    const sold = baseQty(item.soldBase, item.baseUnitFactor);
                    const available = baseQty(item.availableBase, item.baseUnitFactor);
                    return (
                      <tr key={item.presentationId}>
                        <td>{item.productName}<small className="controlled-sub">{item.presentationName}{item.flags?.includes("NO_MOVEMENT") ? " · sin movimiento" : ""}</small></td>
                        <td>{sold.main}{sold.sub ? <small className="controlled-sub">{sold.sub}</small> : null}</td>
                        <td>{Number(item.avgDailyBase).toFixed(2)} u.</td>
                        <td>{available.main}{available.sub ? <small className="controlled-sub">{available.sub}</small> : null}</td>
                        <td>{dayCount(item.daysOfInventory)}</td>
                        <td>{money(item.cogsBob)}</td>
                        <td>{item.stockValueBob === null ? "—" : money(item.stockValueBob)}</td>
                        <td>{item.turnover === null ? "—" : Number(item.turnover).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="field-hint">Días de inventario = disponible ÷ promedio diario vendido. Rotación = costo de lo vendido ÷ valor del stock actual. Cantidades en unidades base.</p>
        </section>
      )}
    </>
  );
}

/** Rotation and days of inventory (analytics.read + analytics.profitability, Profesional+). */
export default function AnalyticsRotationPage() {
  return (
    <AnalyticsFrame kicker="Analítica · Rotación" title="Rotación de inventario." lede="Cuánto dura tu stock según lo que realmente vendes." feature="analytics.profitability" plan="Profesional" what="La rotación">
      {({ branches }) => <Rotation branches={branches} />}
    </AnalyticsFrame>
  );
}
