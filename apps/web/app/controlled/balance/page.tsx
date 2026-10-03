"use client";

import { useEffect, useState } from "react";
import { ControlledDenied, ControlledHeader, PremiumRequired, useControlledAccess } from "../../components/controlled-shared";
import { ControlledNav } from "../../components/controlled-nav";
import { currentMonth, getControlledBalance, isPlanRestricted, movementTypeLabel, type BalanceFlow, type ControlledBalance } from "../../lib/controlled";

function FlowCell({ flow }: Readonly<{ flow: BalanceFlow }>) {
  const entries = Object.entries(flow.byType).filter(([, value]) => value !== 0);
  if (!entries.length) return <>{flow.total}</>;
  return (
    <details className="controlled-breakdown">
      <summary>{flow.total}</summary>
      <ul>{entries.map(([type, value]) => <li key={type}>{movementTypeLabel(type)}: {value}</li>)}</ul>
    </details>
  );
}

/** Saldo mensual por producto controlado: inicial, entradas, salidas, final y stock actual (unidades base). */
export default function ControlledBalancePage() {
  const access = useControlledAccess();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<ControlledBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (access.status !== "ready" || !/^\d{4}-\d{2}$/.test(month)) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    getControlledBalance(month)
      .then((value) => {
        if (!mounted) return;
        setRestricted(false);
        setData(value);
      })
      .catch((reason) => {
        if (!mounted) return;
        setData(null);
        if (isPlanRestricted(reason)) setRestricted(true);
        else setError(reason instanceof Error ? reason.message : "No pudimos cargar los saldos.");
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [access.status, month]);

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando saldos…</main>;
  if (access.status === "denied") return <ControlledDenied />;

  const isCurrentMonth = month === currentMonth();

  return (
    <main className="procurement-page controlled-page">
      <ControlledHeader kicker="Controlados · Saldos" title="Saldo mensual de controlados." lede="Saldo inicial, entradas, salidas y saldo final de cada medicamento controlado, en unidades base." />
      <ControlledNav />
      {restricted ? <PremiumRequired what="El saldo mensual de controlados" /> : (
        <>
          {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
          <section className="panel">
            <div className="controlled-filters">
              <label className="inventory-filter"><span>Mes</span><input type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value)} /></label>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div><p className="section-kicker">{month}</p><h2>Saldos por producto</h2></div>
              <span className="panel-count">{(data?.items.length ?? 0).toString().padStart(2, "0")}</span>
            </div>
            {loading && !data ? <p className="pos-hint">Cargando…</p> : null}
            {data && data.items.length ? (
              <div className="controlled-table-wrap">
                <table className="invoice-table controlled-table controlled-numeric">
                  <thead><tr><th>Producto</th><th>Saldo inicial</th><th>Entradas</th><th>Salidas</th><th>Saldo final</th><th>Stock actual</th></tr></thead>
                  <tbody>
                    {data.items.map((item) => {
                      const mismatch = isCurrentMonth && item.closingBase !== item.currentStockBase;
                      return (
                        <tr className={mismatch ? "controlled-mismatch" : ""} key={item.productId}>
                          <td>
                            {item.productName}
                            <small className="controlled-sub">{item.presentations.map((presentation) => `${presentation.name} (${presentation.baseUnitFactor} u. base)`).join(" · ")}</small>
                          </td>
                          <td>{item.openingBase}</td>
                          <td><FlowCell flow={item.entries} /></td>
                          <td><FlowCell flow={item.exits} /></td>
                          <td>{item.closingBase}</td>
                          <td>
                            {item.currentStockBase}
                            {mismatch ? <small className="controlled-sub controlled-warning">No coincide con el saldo final: revisa los movimientos.</small> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {data && !data.items.length && !loading ? (
              <div className="procurement-empty">
                <span className="empty-symbol">✦</span>
                <h3>Sin movimientos de controlados en este mes.</h3>
                <p>Elige otro mes o registra compras y ventas de medicamentos controlados.</p>
              </div>
            ) : null}
            <p className="field-hint">Cantidades en unidades base. Abre las entradas o salidas para ver el detalle por tipo de movimiento.</p>
          </section>
        </>
      )}
    </main>
  );
}
