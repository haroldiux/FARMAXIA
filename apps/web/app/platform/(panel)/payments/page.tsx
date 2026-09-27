"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatBob, formatDate } from "../../../lib/saas";
import { approvePayment, openPaymentAttachment, platformPayments, rejectPayment, type PlatformPayment } from "../../../lib/platform";

const tabs = [
  { value: "PENDING", label: "Por revisar" },
  { value: "APPROVED", label: "Aprobados" },
  { value: "REJECTED", label: "Rechazados" }
];
const statusLabel: Record<PlatformPayment["status"], string> = { PENDING: "En revisión", APPROVED: "Aprobado", REJECTED: "Rechazado" };

export default function PlatformPaymentsPage() {
  const [status, setStatus] = useState("PENDING");
  const [payments, setPayments] = useState<PlatformPayment[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: string) => {
    setError(null);
    setPayments(null);
    try {
      setPayments(await platformPayments(nextStatus));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar los pagos.");
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  async function review(payment: PlatformPayment, decision: "approve" | "reject"): Promise<void> {
    const note = notes[payment.id] ?? "";
    if (decision === "reject" && !note.trim()) {
      setError("Escribe el motivo del rechazo: la farmacia lo verá.");
      return;
    }
    setBusyId(payment.id);
    setError(null);
    setNotice(null);
    try {
      if (decision === "approve") {
        await approvePayment(payment.id, note);
        setNotice(`Pago de ${payment.tenantName} aprobado: el comprobante ${payment.invoiceNumber} quedó pagado.`);
      } else {
        await rejectPayment(payment.id, note);
        setNotice(`Pago de ${payment.tenantName} rechazado.`);
      }
      await load(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos revisar el pago.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className="topbar"><div><p className="eyebrow">Plataforma</p><h1>Pagos.</h1></div></header>
      <div className="segmented" role="tablist" aria-label="Estado de los pagos">
        {tabs.map((tab) => (
          <button aria-selected={status === tab.value} className={status === tab.value ? "is-active" : ""} key={tab.value} onClick={() => setStatus(tab.value)} role="tab" type="button">{tab.label}</button>
        ))}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      {payments === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : payments.length ? (
        <section className="payment-review-list">
          {payments.map((payment) => {
            const short = Number(payment.amountBob) < Number(payment.invoiceAmountBob);
            return (
              <article className="panel payment-review" key={payment.id}>
                <div className="payment-review-head">
                  <div>
                    <Link className="payment-tenant" href={`/platform/tenants/${payment.tenantId}`}>{payment.tenantName}</Link>
                    <small>Comprobante {payment.invoiceNumber} · enviado {formatDate(payment.submittedAt, true)} por {payment.submittedBy}</small>
                  </div>
                  <span className={`order-status ${payment.status === "APPROVED" ? "order-paid" : payment.status === "REJECTED" ? "order-overdue" : "order-open"}`}>{statusLabel[payment.status]}</span>
                </div>
                <dl className="payment-facts">
                  <div><dt>Medio</dt><dd>{payment.method === "QR" ? "QR" : "Transferencia"}</dd></div>
                  <div><dt>Referencia</dt><dd>{payment.reference}</dd></div>
                  <div><dt>Fecha de pago</dt><dd>{formatDate(`${payment.paidOn}T12:00:00`)}</dd></div>
                  <div><dt>Monto declarado</dt><dd className={short ? "amount-short" : ""}>{formatBob(payment.amountBob)}</dd></div>
                  <div><dt>Monto del comprobante</dt><dd>{formatBob(payment.invoiceAmountBob)}</dd></div>
                </dl>
                {short ? <p className="form-error">El monto declarado es menor al del comprobante: no se puede aprobar.</p> : null}
                {payment.reviewNote ? <p className="form-note">Nota: {payment.reviewNote}</p> : null}
                <div className="payment-review-actions">
                  {payment.attachmentMediaType
                    ? <button className="quiet-button" onClick={() => void openPaymentAttachment(payment.id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos abrir el comprobante."))} type="button">Ver comprobante adjunto</button>
                    : <span className="action-muted">Sin comprobante adjunto</span>}
                  {payment.status === "PENDING" ? (
                    <>
                      <input aria-label="Nota de revisión" className="review-note" maxLength={500} onChange={(event) => setNotes({ ...notes, [payment.id]: event.target.value })} placeholder="Nota (obligatoria para rechazar)" value={notes[payment.id] ?? ""} />
                      <button className="row-action row-action-muted" disabled={busyId === payment.id} onClick={() => void review(payment, "reject")} type="button">Rechazar</button>
                      <button className="secondary-button" disabled={busyId === payment.id || short} onClick={() => void review(payment, "approve")} type="button">{busyId === payment.id ? "Guardando…" : "Aprobar pago"}</button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : <section className="panel"><div className="inventory-state inventory-empty-inline"><span className="empty-symbol">✓</span><h3>No hay pagos en esta lista.</h3><p>Cuando una farmacia registre un pago aparecerá aquí.</p></div></section>}
    </>
  );
}
