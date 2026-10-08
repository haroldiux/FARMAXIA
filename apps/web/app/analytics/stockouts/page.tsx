"use client";

import { useState } from "react";
import { AnalyticsFrame, PeriodFilters, ReportState, useReport } from "../../components/analytics-shared";
import { formatDateTime } from "../../components/controlled-shared";
import { acknowledgeStockAlert, baseQty, dayCount, errorMessage, getStockouts, kindLabels, listStockAlerts } from "../../lib/analytics";

function Stockouts({ branches }: Readonly<{ branches: Array<{ id: string; name: string }> }>) {
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [reload, setReload] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const stockouts = useReport(() => getStockouts(branchId || undefined), `so|${branchId}`, true, "No pudimos cargar los quiebres de stock.");
  const alerts = useReport(() => listStockAlerts(status, branchId || undefined), `al|${branchId}|${status}|${reload}`, true, "No pudimos cargar las alertas.");

  async function acknowledge(id: string): Promise<void> {
    setBusyId(id);
    setActionError(null);
    try {
      await acknowledgeStockAlert(id);
      setReload((value) => value + 1);
    } catch (reason) {
      setActionError(errorMessage(reason, "No pudimos marcar la alerta como revisada."));
    } finally {
      setBusyId(null);
    }
  }

  const items = stockouts.data?.items ?? [];
  const alertItems = alerts.data?.items ?? [];
  return (
    <>
      <PeriodFilters branchId={branchId} branches={branches} onChange={(next) => next.branchId !== undefined && setBranchId(next.branchId)} />
      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Ahora · últimos {stockouts.data?.velocityDays ?? 30} días de ventas</p><h2>Agotados y poca cobertura</h2></div>
          <span className="panel-count">{items.length.toString().padStart(2, "0")}</span>
        </div>
        <ReportState error={stockouts.error} loading={stockouts.loading} empty={Boolean(stockouts.data) && !items.length} emptyTitle="Sin quiebres de stock." emptyHint="Ningún producto con ventas recientes está agotado o con poca cobertura." />
        {items.length ? (
          <div className="controlled-table-wrap">
            <table className="invoice-table controlled-table controlled-numeric">
              <thead><tr><th>Estado</th><th>Producto</th><th>Sucursal</th><th>Disponible</th><th>Promedio diario</th><th>Días de inventario</th><th>Reposición sugerida (30 días)</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const available = baseQty(item.availableBase, item.baseUnitFactor);
                  const suggested = baseQty(item.suggestedBase, item.baseUnitFactor);
                  return (
                    <tr key={`${item.branchId}-${item.presentationId}`}>
                      <td><span className={`analytics-class ${item.kind === "OUT_OF_STOCK" ? "is-C" : "is-B"}`} style={{ width: "auto", padding: "0 10px", borderRadius: 999 }}>{kindLabels[item.kind]}</span></td>
                      <td>{item.productName}<small className="controlled-sub">{item.presentationName}</small></td>
                      <td>{item.branchName}</td>
                      <td>{available.main}{available.sub ? <small className="controlled-sub">{available.sub}</small> : null}</td>
                      <td>{Number(item.avgDailyBase).toFixed(2)} u.</td>
                      <td>{dayCount(item.daysOfInventory)}</td>
                      <td>{suggested.main}{suggested.sub ? <small className="controlled-sub">{suggested.sub}</small> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="field-hint">Poca cobertura: menos de {stockouts.data?.lowCoverageDays ?? 7} días de stock al ritmo de venta actual. Cantidades en unidades base.</p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">{alerts.data ? `${alerts.data.unacknowledged} sin revisar` : "Alertas"}</p><h2>Alertas de stock</h2></div>
          <span className="panel-count">{alertItems.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="analytics-tabs no-print" role="group" aria-label="Filtrar alertas">
          <button aria-pressed={status === "open"} onClick={() => setStatus("open")} type="button">Abiertas</button>
          <button aria-pressed={status === "all"} onClick={() => setStatus("all")} type="button">Todas</button>
        </div>
        {actionError ? <p className="form-error procurement-message" role="alert">{actionError}</p> : null}
        <ReportState error={alerts.error} loading={alerts.loading} empty={Boolean(alerts.data) && !alertItems.length} emptyTitle="Sin alertas." emptyHint="Las alertas se generan cada hora para los productos agotados o con poca cobertura." />
        {alertItems.length ? (
          <div className="controlled-table-wrap">
            <table className="invoice-table controlled-table controlled-numeric">
              <thead><tr><th>Estado</th><th>Producto</th><th>Sucursal</th><th>Disponible</th><th>Días de stock</th><th>Abierta</th><th>Revisión</th></tr></thead>
              <tbody>
                {alertItems.map((alert) => (
                  <tr key={alert.id}>
                    <td>{kindLabels[alert.kind]}{alert.resolvedAt ? <small className="controlled-sub">Resuelta</small> : null}</td>
                    <td>{alert.productName}<small className="controlled-sub">{alert.presentationName}</small></td>
                    <td>{alert.branchName}</td>
                    <td>{alert.availableBase.toLocaleString("es-BO")} u.</td>
                    <td>{dayCount(alert.daysOfStock)}</td>
                    <td>{formatDateTime(alert.createdAt)}</td>
                    <td>
                      {alert.acknowledgedAt ? <span>Revisada<small className="controlled-sub">{formatDateTime(alert.acknowledgedAt)}</small></span> : (
                        <button className="quiet-button" disabled={busyId === alert.id} onClick={() => void acknowledge(alert.id)} type="button">{busyId === alert.id ? "Guardando…" : "Marcar revisada"}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

/** Current stockouts plus the alert list with acknowledge (analytics.read + analytics.profitability). */
export default function AnalyticsStockoutsPage() {
  return (
    <AnalyticsFrame kicker="Analítica · Quiebres" title="Quiebres de stock." lede="Qué se agotó o está por agotarse, y las alertas pendientes de revisar." feature="analytics.profitability" plan="Profesional" what="Los quiebres de stock">
      {({ branches }) => <Stockouts branches={branches} />}
    </AnalyticsFrame>
  );
}
