"use client";

import { useState } from "react";
import { AnalyticsFrame, ForecastChart, InvalidPeriod, Kpi, PeriodFilters, ReportState, useReport, validPeriod } from "../components/analytics-shared";
import { useShellSession } from "../components/app-shell";
import { baseQty, getDashboard, getForecast, monthStartIso, money, percent, shortDay, todayIso } from "../lib/analytics";
import { planAllows } from "../lib/plan";

function ForecastSection({ branchId }: Readonly<{ branchId: string }>) {
  const forecast = useReport(() => getForecast(branchId || undefined, 30), `forecast|${branchId}`, true, "No pudimos cargar el pronóstico.");
  const [selected, setSelected] = useState("");
  const items = forecast.data?.items ?? [];
  const item = items.find((entry) => entry.presentationId === selected) ?? items[0];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">Próximos 30 días · Premium</p><h2>Pronóstico de demanda</h2></div>
        <span className="panel-count">{items.length.toString().padStart(2, "0")}</span>
      </div>
      <ReportState error={forecast.error} loading={forecast.loading} empty={!items.length} emptyTitle="Aún no hay historial suficiente." emptyHint="El pronóstico usa las últimas 8 semanas completas de ventas." />
      {item ? (
        <>
          <label className="inventory-filter">
            <span>Producto</span>
            <select value={item.presentationId} onChange={(event) => setSelected(event.target.value)}>
              {items.map((entry) => <option key={entry.presentationId} value={entry.presentationId}>{entry.productName} · {entry.presentationName}</option>)}
            </select>
          </label>
          <ForecastChart history={item.history} forecast={item.forecast} />
          <div className="analytics-kpis">
            <Kpi label="Demanda proyectada (30 días)" value={baseQty(item.projectedDemandBase, item.baseUnitFactor).main} hint={baseQty(item.projectedDemandBase, item.baseUnitFactor).sub ?? undefined} />
            <Kpi label="Disponible hoy" value={baseQty(item.availableBase, item.baseUnitFactor).main} hint={baseQty(item.availableBase, item.baseUnitFactor).sub ?? undefined} />
            <Kpi
              label="Quiebre proyectado"
              value={item.stockoutDate ? shortDay(item.stockoutDate) : "Sin quiebre"}
              hint={item.daysUntilStockout === null ? "Sin demanda o cobertura mayor a un año" : `En ${item.daysUntilStockout} días`}
              warn={item.daysUntilStockout !== null && item.daysUntilStockout <= 30}
            />
          </div>
          <p className="field-hint">Estimación simple: promedio móvil más tendencia lineal de las últimas 8 semanas, en unidades base. No es una predicción estadística avanzada.</p>
        </>
      ) : null}
    </section>
  );
}

function Dashboard({ branches }: Readonly<{ branches: Array<{ id: string; name: string }> }>) {
  const shell = useShellSession();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState("");
  const valid = validPeriod(from, to);
  const report = useReport(() => getDashboard({ from, to, branchId: branchId || undefined }), `dash|${from}|${to}|${branchId}`, valid, "No pudimos cargar el panel.");
  const data = report.data;
  const maxRevenue = Math.max(...(data?.topProducts ?? []).map((product) => Number(product.revenueBob)), 1);
  const forecastAllowed = planAllows(shell?.subscription?.features, "analytics.abc");

  return (
    <>
      <PeriodFilters from={from} to={to} branchId={branchId} branches={branches} onChange={(next) => {
        if (next.from !== undefined) setFrom(next.from);
        if (next.to !== undefined) setTo(next.to);
        if (next.branchId !== undefined) setBranchId(next.branchId);
      }} />
      {!valid ? <InvalidPeriod /> : (
        <>
          <ReportState error={report.error} loading={report.loading} empty={false} emptyTitle="" emptyHint="" />
          {data ? (
            <>
              <section className="analytics-kpis">
                <Kpi label="Venta neta" value={money(data.netSalesBob)} hint="Descuenta devoluciones; sin anuladas" />
                <Kpi label="Tickets" value={data.tickets.toLocaleString("es-BO")} hint={`Ticket promedio ${money(data.averageTicketBob)}`} />
                <Kpi label="Unidades vendidas" value={data.units.toLocaleString("es-BO")} hint="En la unidad de cada presentación" />
                <Kpi label="Agotados" value={String(data.outOfStockCount)} hint="Productos con venta reciente y sin stock" warn={data.outOfStockCount > 0} />
                <Kpi
                  label="Por vencer (30 días)"
                  value={money(data.nearExpiry.valueBob)}
                  hint={`${data.nearExpiry.units.toLocaleString("es-BO")} u.${data.nearExpiry.uncostedUnits ? ` · ${data.nearExpiry.uncostedUnits} u. sin costo` : ""}`}
                  warn={data.nearExpiry.units > 0}
                />
                {data.marginAvailable ? (
                  <Kpi label="Margen" value={data.marginBob === null ? "—" : money(data.marginBob)} hint={`Margen ${percent(data.marginPercent)} sobre lo costeado`} />
                ) : (
                  <Kpi label="Margen" value="—" hint="Disponible desde el plan Profesional" />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div><p className="section-kicker">Por ingresos netos</p><h2>Productos más vendidos</h2></div>
                  <span className="panel-count">{data.topProducts.length.toString().padStart(2, "0")}</span>
                </div>
                {data.topProducts.length ? (
                  <div className="analytics-bars">
                    {data.topProducts.map((product) => (
                      <div className="analytics-bar-row" key={product.productId}>
                        <span>{product.productName}</span>
                        <span className="analytics-bar-track" role="img" aria-label={`${product.sharePercent} % de la venta`}><i style={{ width: `${Math.max(2, (Number(product.revenueBob) / maxRevenue) * 100)}%` }} /></span>
                        <strong>{money(product.revenueBob)} <small>({percent(product.sharePercent)})</small></strong>
                      </div>
                    ))}
                  </div>
                ) : <p className="pos-hint">Sin ventas en este período.</p>}
              </section>
            </>
          ) : null}
        </>
      )}
      {forecastAllowed ? <ForecastSection branchId={branchId} /> : <p className="field-hint">El pronóstico de demanda requiere el plan Premium.</p>}
    </>
  );
}

/** Executive dashboard (analytics.read). KPIs are available on every plan; the forecast needs analytics.abc. */
export default function AnalyticsDashboardPage() {
  return (
    <AnalyticsFrame kicker="Analítica · Panel" title="Panel ejecutivo." lede="Ventas, ticket promedio, agotados, productos por vencer y margen del período.">
      {({ branches }) => <Dashboard branches={branches} />}
    </AnalyticsFrame>
  );
}
