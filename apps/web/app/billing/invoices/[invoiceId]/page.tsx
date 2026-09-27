"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { formatBob, formatDate, invoiceDocument, type InvoiceDocument } from "../../../lib/saas";

const statusLabel: Record<InvoiceDocument["status"], string> = { OPEN: "Pendiente de pago", PAID: "Pagado", VOID: "Anulado" };

export default function InvoicePage() {
  const params = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<InvoiceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoiceDocument(params.invoiceId)
      .then(setInvoice)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar el comprobante."));
  }, [params.invoiceId]);

  if (error) {
    return <main className="center-state inventory-denied"><div><strong>Comprobante no disponible</strong><p>{error}</p><Link href="/billing">Volver a la suscripción</Link></div></main>;
  }
  if (!invoice) {
    return <main className="center-state"><span className="loading-orb" />Cargando comprobante…</main>;
  }

  const approved = invoice.payments.find((payment) => payment.status === "APPROVED");

  return (
    <main className="invoice-page">
      <div className="invoice-actions no-print">
        <Link className="back-link" href="/billing">← Volver a la suscripción</Link>
        <button className="quiet-button" onClick={() => window.print()} type="button">Imprimir o guardar PDF</button>
      </div>
      <article className="invoice-sheet">
        <header className="invoice-header">
          <div className="brand-lockup">
            <div className="brand-mark invoice-mark">F</div>
            <div><strong>FARMAXIA</strong><span>Software para farmacias</span></div>
          </div>
          <div className="invoice-number">
            <p>Comprobante de cobro</p>
            <strong>{invoice.number}</strong>
            <span className={`subscription-badge badge-${invoice.status === "PAID" ? "active" : invoice.status === "VOID" ? "canceled" : "trialing"}`}>{statusLabel[invoice.status]}</span>
          </div>
        </header>

        <section className="invoice-parties">
          <div><p className="section-kicker">Cliente</p><strong>{invoice.customer.legalName ?? invoice.customer.pharmacyName}</strong><span>{invoice.customer.pharmacyName}</span>{invoice.customer.taxId ? <span>NIT {invoice.customer.taxId}</span> : null}</div>
          <div><p className="section-kicker">Fechas</p><span>Emitido: {formatDate(invoice.issuedAt)}</span><span>Vence: {formatDate(invoice.dueAt)}</span>{invoice.paidAt ? <span>Pagado: {formatDate(invoice.paidAt)}</span> : null}</div>
        </section>

        <table className="invoice-table">
          <thead><tr><th>Concepto</th><th>Periodo</th><th>Importe</th></tr></thead>
          <tbody>
            <tr>
              <td>Suscripción FARMAXIA · plan {invoice.planName}</td>
              <td>{formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}</td>
              <td>{formatBob(invoice.amountBob)}</td>
            </tr>
          </tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td>{formatBob(invoice.amountBob)}</td></tr></tfoot>
        </table>

        {approved ? <p className="invoice-paid">Pago recibido por {approved.method === "QR" ? "QR" : "transferencia"} · referencia {approved.reference}.</p> : null}
        <footer className="invoice-footer">
          Documento no fiscal. La factura electrónica se emitirá cuando FARMAXIA habilite la facturación SIAT.
        </footer>
      </article>
    </main>
  );
}
