"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CustomersNav } from "../../../components/customers-nav";
import { CrmDenied, CrmPlanRequired, useCrmSession } from "../../../components/customers-shared";
import {
  downloadStatementCsv,
  errorMessage,
  formatDateTime,
  formatDay,
  formatPlainDay,
  getStatement,
  isPlanRestricted,
  money,
  newStatementPaymentKey,
  planAllows,
  registerStatementPayment,
  statementPaymentMethodLabels,
  statementStatusLabels,
  todayIso,
  type StatementDetail,
  type StatementPaymentMethod
} from "../../../lib/customers";

/** Printable (A4) statement of one agreement and month, with payments and CSV export. Not a fiscal invoice. */
export default function StatementDetailPage() {
  const { statementId } = useParams<{ statementId: string }>();
  const { session, features } = useCrmSession();
  const [statement, setStatement] = useState<StatementDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<StatementPaymentMethod>("TRANSFER");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // The same payload retried (lost answer) reuses its key so the payment is recorded once; a changed payload gets a new key.
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  const allowed = session?.permissions.includes("agreements.billing") ?? false;
  const planKnown = features !== undefined;
  const planOk = planAllows(features, "crm.agreements");
  const ready = allowed && planKnown && planOk;

  const load = useCallback(async () => {
    try {
      const loaded = await getStatement(statementId);
      setStatement(loaded);
      setAmount((current) => (current === "" ? Number(loaded.balanceBob).toFixed(2) : current));
    } catch (failure) {
      if (isPlanRestricted(failure)) setRestricted(true);
      else setError(errorMessage(failure, "No pudimos cargar el estado de cuenta."));
    }
  }, [statementId]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function pay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!statement) return;
    const input = { amountBob: amount.trim(), method, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newStatementPaymentKey() };
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await registerStatementPayment(statement.id, input, attempt.current.key);
      attempt.current = null;
      setNotice(result.status === "PAID" ? "Pago registrado: el estado de cuenta quedó pagado." : `Pago registrado. Saldo pendiente: ${money(result.balanceBob)}.`);
      setReference("");
      setAmount("");
      await load();
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos registrar el pago."));
    } finally {
      setSaving(false);
    }
  }

  async function downloadCsv(): Promise<void> {
    if (!statement) return;
    setDownloading(true);
    setError(null);
    try {
      await downloadStatementCsv(statement.id, `estado-de-cuenta-${statement.number}.csv`);
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos descargar el CSV."));
    } finally {
      setDownloading(false);
    }
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!allowed) return <CrmDenied />;
  if (!planOk || restricted) return <main className="procurement-page"><CustomersNav /><CrmPlanRequired plan="Premium" what="Los estados de cuenta de convenios" /></main>;
  if (!statement) {
    return <main className="center-state">{error ? <div><p className="form-error" role="alert">{error}</p><Link href="/customers/statements">Volver a estados de cuenta</Link></div> : <><span className="loading-orb" />Cargando estado de cuenta…</>}</main>;
  }

  const open = statement.status !== "PAID";

  return (
    <main className="procurement-page controlled-book-page">
      <style>{"@media print { @page { size: A4; margin: 12mm; } }"}</style>
      <div className="no-print"><CustomersNav /></div>
      <div className="receipt-toolbar no-print">
        <Link className="back-link" href="/customers/statements">← Volver a estados de cuenta</Link>
        <button className="quiet-button" disabled={downloading} onClick={() => void downloadCsv()} type="button">{downloading ? "Descargando…" : "Descargar CSV"}</button>
        <button className="primary-button" onClick={() => window.print()} type="button">Imprimir<span aria-hidden="true">⎙</span></button>
      </div>
      {error ? <p className="form-error procurement-message no-print" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message no-print" role="status">{notice}</p> : null}

      <section className="panel controlled-book-sheet">
        <div className="panel-heading">
          <div><p className="section-kicker">Estado de cuenta {statement.number}</p><h2>{statement.agreementName} · {statement.period}</h2></div>
          <span className={`order-status ${statement.status === "PAID" ? "sale-confirmed" : statement.status === "PARTIAL" ? "sale-partially_returned" : "quote-expired"}`}>{statementStatusLabels[statement.status]}</span>
        </div>
        <p className="field-hint">
          Entidad pagadora: <strong>{statement.payerName}</strong>{statement.payerTaxId ? ` · NIT ${statement.payerTaxId}` : ""} · cobertura {Number(statement.coveragePercent)}%<br />
          Emitido el {formatDateTime(statement.issuedAt)}{statement.issuedByName ? ` por ${statement.issuedByName}` : ""} · {statement.lineCount} {statement.lineCount === 1 ? "cargo" : "cargos"}
        </p>
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table">
            <thead><tr><th>Venta</th><th>Sucursal</th><th>Fecha</th><th>Afiliado</th><th>Código</th><th>Monto</th></tr></thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.chargeId}><td>{line.saleNumber}</td><td>{line.branchCode}</td><td>{formatDay(line.saleDate)}</td><td>{line.customerName}</td><td>{line.memberCode}</td><td>{money(line.amountBob)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="receipt-totals">
          <div className="receipt-total"><span>TOTAL</span><strong>{money(statement.totalBob)}</strong></div>
          <div><span>Pagado</span><span>{money(statement.paidBob)}</span></div>
          <div><span>Saldo</span><span>{money(statement.balanceBob)}</span></div>
        </div>
        {statement.payments.length ? (
          <div className="payment-history">
            <p className="section-kicker">Pagos recibidos</p>
            {statement.payments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <div><strong>{money(payment.amountBob)}</strong><small>{formatPlainDay(payment.paidOn)} · {statementPaymentMethodLabels[payment.method]}{payment.reference ? ` · ${payment.reference}` : ""}</small></div>
                <small>{payment.createdByName ?? ""}</small>
              </div>
            ))}
          </div>
        ) : null}
        <p className="field-hint">Documento no fiscal — no válido como factura.</p>
      </section>

      {open ? (
        <section className="panel no-print">
          <div className="panel-heading"><div><p className="section-kicker">Pago de la entidad</p><h2>Registrar pago</h2></div></div>
          <form className="cash-form" onSubmit={pay}>
            <div className="procurement-field-grid">
              <label className="field"><span>Monto (Bs)</span><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
              <label className="field"><span>Fecha de pago</span><input max={todayIso()} required type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
            </div>
            <label className="field"><span>Método</span>
              <select value={method} onChange={(event) => setMethod(event.target.value as StatementPaymentMethod)}>
                {(Object.keys(statementPaymentMethodLabels) as StatementPaymentMethod[]).map((value) => <option key={value} value={value}>{statementPaymentMethodLabels[value]}</option>)}
              </select>
            </label>
            <label className="field"><span>Referencia <small>opcional</small></span><input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="N.º de transferencia o cheque" /></label>
            <button className="primary-button" disabled={saving} type="submit">{saving ? "Registrando…" : "Registrar pago"}<span>↗</span></button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
