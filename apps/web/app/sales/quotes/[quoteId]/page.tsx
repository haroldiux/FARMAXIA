"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SalesNav } from "../../../components/sales-nav";
import { cancelQuote, getQuote, quoteStatusLabels, type QuoteDetail } from "../../../lib/sales";

type Paper = "58" | "80" | "A4";

function money(value: string): string {
  return Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", { dateStyle: "long" });
}

const pageRules: Record<Paper, string> = {
  "58": "@page { size: 58mm auto; margin: 2mm; }",
  "80": "@page { size: 80mm auto; margin: 2mm; }",
  A4: "@page { size: A4; margin: 14mm; }"
};

/** Detalle de proforma e impresión (58 mm, 80 mm o A4). No es una venta ni una factura. */
export default function QuoteDetailPage() {
  const { quoteId } = useParams<{ quoteId: string }>();
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<Paper>("80");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("farmaxia.quotePaper");
      if (saved === "58" || saved === "80" || saved === "A4") setPaper(saved);
    } catch {
      // Preference storage is optional.
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setQuote(await getQuote(quoteId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar la proforma.");
    }
  }, [quoteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function choosePaper(value: Paper): void {
    setPaper(value);
    try {
      window.localStorage.setItem("farmaxia.quotePaper", value);
    } catch {
      // Ignore storage failures; the choice still applies to this page.
    }
  }

  async function cancel(): Promise<void> {
    if (busy || !window.confirm("¿Anular esta proforma? Esta acción no se puede deshacer.")) return;
    setBusy(true);
    setError(null);
    try {
      setQuote(await cancelQuote(quoteId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos anular la proforma.");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (!quote) {
    return <main className="center-state">{error ? <div><p className="form-error" role="alert">{error}</p><Link href="/sales/quotes">Volver a proformas</Link></div> : <><span className="loading-orb" />Cargando proforma…</>}</main>;
  }

  const open = quote.status === "OPEN";
  const validity = `Proforma — no es una venta ni una factura · válida hasta ${formatDate(quote.validUntil)}`;

  return (
    <main className="receipt-page">
      {/* The paper size is applied only while printing. */}
      <style>{`@media print { ${pageRules[paper]} }`}</style>
      <div className="receipt-nav no-print"><SalesNav /></div>
      <div className="receipt-toolbar no-print">
        <Link className="back-link" href="/sales/quotes">← Volver a proformas</Link>
        <div className="segmented" role="group" aria-label="Tamaño del papel">
          {(["58", "80", "A4"] as const).map((value) => (
            <button aria-pressed={paper === value} className={paper === value ? "is-active" : ""} key={value} onClick={() => choosePaper(value)} type="button">{value === "A4" ? "A4" : `${value} mm`}</button>
          ))}
        </div>
        <button className="primary-button" onClick={() => window.print()} type="button">Imprimir proforma<span aria-hidden="true">⎙</span></button>
      </div>

      <section className="panel receipt-summary no-print">
        <p className="section-kicker">Proforma {quote.number}</p>
        <h2>{money(quote.totalBob)} Bs · <span className={`order-status quote-${quote.status.toLowerCase()}`}>{quoteStatusLabels[quote.status]}</span></h2>
        <p>{formatDateTime(quote.createdAt)} · Válida hasta {formatDateTime(quote.validUntil)} · Creada por {quote.createdBy.name ?? "—"}{quote.customerName ? ` · Cliente ${quote.customerName}` : ""}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {quote.status === "CONVERTED" && quote.convertedSaleId ? <p className="field-hint">Convertida en la venta <Link href={`/sales/${quote.convertedSaleId}`}>{quote.convertedSaleNumber ?? "ver venta"}</Link>.</p> : null}
        {open && quote.pricesChanged ? (
          <p className="pos-notice" role="status">
            Los precios cambiaron desde que se hizo la proforma{quote.currentTotalBob ? `: hoy el total sería ${money(quote.currentTotalBob)} Bs` : " y algún producto ya no tiene precio vigente"}. Al convertirla se cobrará con el precio vigente.
          </p>
        ) : null}
        {open ? (
          <div className="user-actions">
            <Link className="primary-button receipt-link" href={`/sales?quoteId=${quote.id}`}>Convertir en venta</Link>
            <button className="quiet-button pos-touch" disabled={busy} onClick={() => void cancel()} type="button">{busy ? "Anulando…" : "Anular proforma"}</button>
          </div>
        ) : <p className="field-hint">Esta proforma ya no se puede convertir en venta.</p>}
        <div className="sales-table-wrap">
          <table className="sales-table">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio proforma</th><th>Precio hoy</th></tr></thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.presentationId}>
                  <td>{item.productName} · {item.presentationName}</td>
                  <td>{item.quantity}</td>
                  <td className="sales-amount">{money(item.quotedUnitPriceBob)}</td>
                  <td className="sales-amount">{item.currentUnitPriceBob === null ? "Sin precio" : money(item.currentUnitPriceBob)}{item.priceChanged ? <small className="sales-refunded"> ← cambió</small> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <article className={`receipt receipt-${paper.toLowerCase()}${quote.status === "CANCELED" ? " receipt-voided" : ""}`} aria-label="Proforma imprimible">
        <header className="receipt-head">
          <strong>{quote.pharmacy.legalName}</strong>
          <span>NIT {quote.pharmacy.taxId}</span>
          <span>{quote.pharmacy.name} · Suc. {quote.branch.code} {quote.branch.name}</span>
        </header>
        <p className="receipt-notice"><strong>PROFORMA — no es una venta ni una factura</strong></p>
        {quote.status === "CANCELED" ? <p className="receipt-void-mark">ANULADA</p> : null}
        {quote.status === "EXPIRED" ? <p className="receipt-void-mark">VENCIDA</p> : null}
        <dl className="receipt-meta">
          <div><dt>Proforma</dt><dd>{quote.number}</dd></div>
          <div><dt>Fecha</dt><dd>{formatDateTime(quote.createdAt)}</dd></div>
          <div><dt>Válida hasta</dt><dd>{formatDateTime(quote.validUntil)}</dd></div>
          {quote.customerName ? <div><dt>Cliente</dt><dd>{quote.customerName}</dd></div> : null}
          <div><dt>Atendió</dt><dd>{quote.createdBy.name ?? "—"}</dd></div>
        </dl>
        <table className="receipt-lines">
          <thead><tr><th>Descripción</th><th>Cant.</th><th>P.Unit</th><th>Importe</th></tr></thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.presentationId}>
                <td>{item.productName} {item.presentationName}</td>
                <td>{item.quantity}</td>
                <td>{money(item.quotedUnitPriceBob)}</td>
                <td>{money(item.lineTotalBob)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-totals">
          <div className="receipt-total"><span>TOTAL Bs</span><strong>{money(quote.totalBob)}</strong></div>
        </div>
        {quote.customerNote ? <p className="receipt-quote-note">{quote.customerNote}</p> : null}
        <footer className="receipt-foot">
          <span>{validity}</span>
          <span>Los precios pueden variar al momento de la compra.</span>
        </footer>
      </article>
    </main>
  );
}
