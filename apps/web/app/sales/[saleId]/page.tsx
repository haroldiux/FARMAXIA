"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SaleActions } from "../../components/sale-actions";
import { SalesNav } from "../../components/sales-nav";
import { currentSession } from "../../lib/session";
import { getSale, salePaymentMethodLabels, saleStatusLabels, type SaleDetail } from "../../lib/sales";

type PaperWidth = 58 | 80;

function money(value: string): string {
  return Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

function formatMonth(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-BO", { month: "2-digit", year: "numeric" });
}

/** Detalle de venta y recibo NO fiscal imprimible en papel térmico de 58 u 80 mm (decisión provisional D44). */
export default function SaleDetailPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState<PaperWidth>(80);
  const [canVoid, setCanVoid] = useState(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("farmaxia.receiptWidth"));
      if (saved === 58 || saved === 80) setWidth(saved);
    } catch {
      // Preference storage is optional.
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setSale(await getSale(saleId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar la venta.");
    }
  }, [saleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    currentSession().then((session) => setCanVoid(session.permissions.includes("sales.void"))).catch(() => undefined);
  }, []);

  function chooseWidth(value: PaperWidth): void {
    setWidth(value);
    try {
      window.localStorage.setItem("farmaxia.receiptWidth", String(value));
    } catch {
      // Ignore storage failures; the choice still applies to this page.
    }
  }

  if (!sale) {
    return <main className="center-state">{error ? <div><p className="form-error" role="alert">{error}</p><Link href="/sales/history">Volver al historial</Link></div> : <><span className="loading-orb" />Cargando venta…</>}</main>;
  }

  return (
    <main className="receipt-page">
      {/* The paper size is applied only while printing. */}
      <style>{`@media print { @page { size: ${width}mm auto; margin: 2mm; } }`}</style>
      <div className="receipt-nav no-print"><SalesNav /></div>
      <div className="receipt-toolbar no-print">
        <Link className="back-link" href="/sales/history">← Volver al historial</Link>
        <div className="segmented" role="group" aria-label="Ancho del papel">
          {([58, 80] as const).map((value) => (
            <button aria-pressed={width === value} className={width === value ? "is-active" : ""} key={value} onClick={() => chooseWidth(value)} type="button">{value} mm</button>
          ))}
        </div>
        <button className="primary-button" onClick={() => window.print()} type="button">Imprimir recibo<span aria-hidden="true">⎙</span></button>
      </div>

      <section className="panel receipt-summary no-print">
        <p className="section-kicker">Venta {sale.number}</p>
        <h2>{money(sale.totalBob)} Bs · {saleStatusLabels[sale.status]}</h2>
        <p>{formatDateTime(sale.createdAt)} · Cajero {sale.cashier.name ?? "—"} · Caja {sale.shift.registerCode} · Almacén {sale.warehouse.name}</p>
        {sale.items.map((item, index) => (
          <p className="field-hint" key={index}>
            {item.productName} · {item.presentationName}{item.returnedQuantity > 0 ? ` (devueltas ${item.returnedQuantity} de ${item.quantity})` : ""} — Lotes: {item.allocations.map((allocation) => `${allocation.lotCode} (vence ${formatMonth(allocation.expiresOn)}, ${allocation.quantityBase} u.)`).join(", ")}{item.fefoOverride ? ` — Lote elegido manualmente${item.fefoOverrideReason ? `: ${item.fefoOverrideReason}` : ""}` : ""}
          </p>
        ))}
        {sale.void ? <p className="sale-void-banner">Venta anulada el {formatDateTime(sale.void.at)} por {sale.void.byName ?? "—"}. Motivo: {sale.void.reason}</p> : null}
        {sale.returns.length ? (
          <ul className="sale-return-history">
            {sale.returns.map((entry) => (
              <li key={entry.id}>
                {entry.number} · {formatDateTime(entry.createdAt)} · Reembolso {money(entry.refundAmountBob)} Bs ({salePaymentMethodLabels[entry.refundMethod]}{entry.refundReference ? ` ${entry.refundReference}` : ""}) · {entry.restock ? "Vuelve al stock" : "Sin reponer stock"} · {entry.reason}
                {" — "}{entry.items.map((line) => `${line.quantity} × ${line.productName}`).join(", ")}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {canVoid ? <SaleActions onChanged={reload} sale={sale} /> : null}

      <article className={`receipt receipt-${width}${sale.status === "VOIDED" ? " receipt-voided" : ""}`} aria-label="Recibo de venta">
        <header className="receipt-head">
          <strong>{sale.pharmacy.legalName}</strong>
          <span>NIT {sale.pharmacy.taxId}</span>
          <span>{sale.pharmacy.name} · Suc. {sale.branch.code} {sale.branch.name}</span>
        </header>
        <p className="receipt-notice"><strong>Documento no fiscal — no válido como factura</strong></p>
        {sale.status === "VOIDED" ? <p className="receipt-void-mark">ANULADA</p> : null}
        <dl className="receipt-meta">
          <div><dt>Venta</dt><dd>{sale.number}</dd></div>
          <div><dt>Fecha</dt><dd>{formatDateTime(sale.createdAt)}</dd></div>
          <div><dt>Cajero</dt><dd>{sale.cashier.name ?? "—"}</dd></div>
        </dl>
        <table className="receipt-lines">
          <thead><tr><th>Descripción</th><th>Cant.</th><th>P.Unit</th><th>Importe</th></tr></thead>
          <tbody>
            {sale.items.map((item, index) => (
              <tr key={index}>
                <td>{item.productName} {item.presentationName}</td>
                <td>{item.quantity}</td>
                <td>{money(item.unitPriceBob)}</td>
                <td>{money(item.lineTotalBob)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-totals">
          <div className="receipt-total"><span>TOTAL Bs</span><strong>{money(sale.totalBob)}</strong></div>
          {sale.payments.map((payment, index) => (
            <div key={index}><span>{salePaymentMethodLabels[payment.method]}{payment.reference ? ` (${payment.reference})` : ""}</span><span>{money(payment.amountBob)}</span></div>
          ))}
          <div><span>Recibido</span><span>{money(sale.paidAmountBob)}</span></div>
          <div><span>Cambio</span><span>{money(sale.changeAmountBob)}</span></div>
          {sale.returns.map((entry) => (
            <div key={entry.id}><span>Devuelto {entry.number}</span><span>− {money(entry.refundAmountBob)}</span></div>
          ))}
        </div>
        <footer className="receipt-foot">
          <span>Documento no fiscal — no válido como factura</span>
          <span>¡Gracias por su compra!</span>
        </footer>
      </article>
    </main>
  );
}
