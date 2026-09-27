"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  daysUntil,
  formatBob,
  formatDate,
  listInvoices,
  readFileAsBase64,
  resourceLabels,
  statusLabels,
  submitPayment,
  subscriptionSummary,
  type SubscriptionSummary,
  type TenantInvoice
} from "../lib/saas";
import { currentSession, type AuthSession } from "../lib/session";

const invoiceStatus: Record<TenantInvoice["status"], { label: string; className: string }> = {
  OPEN: { label: "Por pagar", className: "order-open" },
  PAID: { label: "Pagado", className: "order-paid" },
  VOID: { label: "Anulado", className: "order-canceled" }
};
const paymentStatus: Record<string, string> = { PENDING: "En revisión", APPROVED: "Aprobado", REJECTED: "Rechazado" };
const maxAttachmentBytes = 2 * 1024 * 1024;

function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function BillingPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [invoices, setInvoices] = useState<TenantInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [method, setMethod] = useState<"QR" | "TRANSFER">("QR");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh(): Promise<void> {
    const [nextSummary, nextInvoices] = await Promise.all([subscriptionSummary(), listInvoices()]);
    setSummary(nextSummary);
    setInvoices(nextInvoices);
  }

  useEffect(() => {
    setBlocked(new URLSearchParams(window.location.search).get("bloqueado") === "1");
    currentSession()
      .then(async (value) => {
        setSession(value);
        if (value.permissions.includes("billing.manage")) {
          await refresh();
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.message.startsWith("SESSION")) {
          window.location.assign("/");
          return;
        }
        setError(reason instanceof Error ? reason.message : "No pudimos cargar la suscripción.");
      })
      .finally(() => setLoading(false));
  }, []);

  const featureGroups = useMemo(() => {
    const groups = new Map<string, SubscriptionSummary["features"]>();
    for (const feature of summary?.features ?? []) {
      groups.set(feature.module, [...(groups.get(feature.module) ?? []), feature]);
    }
    return [...groups.entries()];
  }, [summary]);

  const payingInvoice = invoices.find((invoice) => invoice.id === payingId) ?? null;

  function openPayment(invoice: TenantInvoice): void {
    setPayingId(invoice.id);
    setAmount(invoice.amountBob);
    setReference("");
    setPaidOn(todayIso());
    setFile(null);
    setNotice(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!payingInvoice) return;
    if (file && file.size > maxAttachmentBytes) {
      setError("El comprobante debe pesar como máximo 2 MB.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await submitPayment(payingInvoice.id, {
        method,
        reference,
        amountBob: amount,
        paidOn,
        attachment: file ? { mediaType: file.type, base64: await readFileAsBase64(file) } : undefined
      });
      setPayingId(null);
      setNotice(`Pago del comprobante ${payingInvoice.number} enviado. FARMAXIA lo revisará y activará tu periodo.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando suscripción…</main>;
  }
  if (!session) {
    return <main className="center-state"><div><strong>No pudimos validar tu sesión.</strong><p>{error}</p><Link href="/">Volver al ingreso</Link></div></main>;
  }
  if (!session.permissions.includes("billing.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Solo el responsable de la farmacia puede ver la suscripción y los pagos.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  const trialDays = daysUntil(summary?.trialEndsAt ?? null);

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">Suscripción</p>
          <h1>Tu plan y tus pagos.</h1>
          <p className="cash-lede">Revisa lo que incluye tu plan, cuánto usas y paga tus comprobantes por QR o transferencia.</p>
        </div>
      </header>

      {blocked && summary && !summary.hasAccess ? <p className="form-error cash-message" role="alert">Tu suscripción no está activa, por eso los módulos están bloqueados. Registra el pago de tu comprobante pendiente para reactivarla.</p> : null}
      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success cash-message" role="status">{notice}</p> : null}

      {summary ? (
        <section className="billing-overview" aria-label="Resumen del plan">
          <article className={`plan-hero status-${summary.status.toLowerCase()}`}>
            <div className="plan-hero-top">
              <span className={`subscription-badge badge-${summary.status.toLowerCase()}`}>{statusLabels[summary.status]}</span>
              <span className="plan-hero-price">{Number(summary.plan.priceMonthlyBob) > 0 ? <>{formatBob(summary.plan.priceMonthlyBob)}<small>/mes</small></> : "Sin costo"}</span>
            </div>
            <p className="section-kicker">Plan actual</p>
            <h2>{summary.plan.name}</h2>
            <dl className="plan-dates">
              {summary.status === "TRIALING" ? <div><dt>Prueba gratis hasta</dt><dd>{formatDate(summary.trialEndsAt)}{trialDays !== null && trialDays > 0 ? ` · ${trialDays} ${trialDays === 1 ? "día" : "días"}` : ""}</dd></div> : null}
              {summary.currentPeriodEnd ? <div><dt>Pagado hasta</dt><dd>{formatDate(summary.currentPeriodEnd)}</dd></div> : null}
              {summary.status === "PAST_DUE" ? <div><dt>Plazo para pagar</dt><dd>{formatDate(summary.graceEndsAt)}</dd></div> : null}
              <div><dt>Bitácora visible</dt><dd>{summary.plan.auditRetentionDays === null ? "Todo el historial" : `Últimos ${summary.plan.auditRetentionDays} días`}</dd></div>
            </dl>
            <p className="form-note">Para cambiar de plan escribe a FARMAXIA; el cambio se refleja en tu siguiente comprobante.</p>
          </article>

          <article className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Uso del plan</p><h2>Límites</h2></div></div>
            <div className="usage-list">
              {summary.usage.map((row) => {
                const percent = row.limit ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
                return (
                  <div className="usage-row" key={row.resource}>
                    <div><strong>{resourceLabels[row.resource] ?? row.resource}</strong><span>{row.used} de {row.limit ?? "ilimitadas"}</span></div>
                    <div className="usage-bar" aria-hidden="true"><span className={percent >= 100 ? "is-full" : ""} style={{ width: `${row.limit === null ? 8 : Math.max(percent, 4)}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>
      ) : null}

      {summary ? (
        <section className="panel feature-panel" aria-label="Funcionalidades del plan">
          <div className="panel-heading"><div><p className="section-kicker">Incluido en tu plan</p><h2>Funcionalidades</h2></div><span className="panel-count">{summary.features.filter((feature) => feature.enabled).length.toString().padStart(2, "0")}</span></div>
          <div className="feature-groups">
            {featureGroups.map(([module, features]) => (
              <div className="feature-group" key={module}>
                <h3>{module}</h3>
                <ul>
                  {features.map((feature) => (
                    <li className={feature.enabled ? "is-enabled" : "is-disabled"} key={feature.code}>
                      <span aria-hidden="true">{feature.enabled ? "✓" : "–"}</span>{feature.name}
                      {feature.addOn ? <em>extra</em> : null}
                      <span className="sr-only">{feature.enabled ? " (incluida)" : " (no incluida)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="cash-layout">
        <article className="panel cash-shifts-panel">
          <div className="panel-heading"><div><p className="section-kicker">Cobros</p><h2>Comprobantes</h2></div><span className="panel-count">{invoices.length.toString().padStart(2, "0")}</span></div>
          {invoices.length ? <div className="order-list">{invoices.map((invoice) => {
            const pending = invoice.payments.some((payment) => payment.status === "PENDING");
            return (
              <article className="order-card" key={invoice.id}>
                <div className="order-card-head">
                  <div><strong>{invoice.number} · {invoice.planName}</strong><small>{formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}</small></div>
                  <span className={`order-status ${invoiceStatus[invoice.status].className}`}>{invoiceStatus[invoice.status].label}</span>
                </div>
                <div className="order-lines">
                  <div className="order-line"><span>Monto</span><strong>{formatBob(invoice.amountBob)}</strong></div>
                  <div className="order-line"><span>{invoice.status === "PAID" ? "Pagado el" : "Vence"}</span><small>{formatDate(invoice.status === "PAID" ? invoice.paidAt : invoice.dueAt)}</small></div>
                  {invoice.payments.map((payment) => (
                    <div className="order-line payment-line" key={payment.id}>
                      <span>{payment.method === "QR" ? "QR" : "Transferencia"} · {payment.reference}{payment.reviewNote ? <em> — {payment.reviewNote}</em> : null}</span>
                      <strong>{formatBob(payment.amountBob)}</strong>
                      <small className={`payment-status payment-${payment.status.toLowerCase()}`}>{paymentStatus[payment.status]}</small>
                    </div>
                  ))}
                </div>
                <div className="order-card-foot">
                  <Link className="row-action" href={`/billing/invoices/${invoice.id}`}>Ver comprobante</Link>
                  {invoice.status === "OPEN" && !pending ? <button className="row-action" onClick={() => openPayment(invoice)} type="button">Registrar pago</button> : null}
                  {pending ? <span className="action-muted">Pago en revisión</span> : null}
                </div>
              </article>
            );
          })}</div> : <div className="procurement-empty"><span className="empty-symbol">✓</span><h3>No tienes comprobantes.</h3><p>Los planes sin costo no generan cobros.</p></div>}
        </article>

        <aside className="panel cash-form-panel">
          <div className="panel-heading"><div><p className="section-kicker">Pago</p><h2>{payingInvoice ? `Pagar ${payingInvoice.number}` : "Registrar un pago"}</h2></div>{payingInvoice ? <button aria-label="Cerrar pago" className="close-action" onClick={() => setPayingId(null)} type="button">×</button> : null}</div>
          {payingInvoice ? (
            <form className="cash-form" onSubmit={submit}>
              <p className="action-context">Monto del comprobante: <strong>{formatBob(payingInvoice.amountBob)}</strong></p>
              <fieldset className="method-picker">
                <legend>Medio de pago</legend>
                <label><input checked={method === "QR"} name="method" onChange={() => setMethod("QR")} type="radio" /> QR</label>
                <label><input checked={method === "TRANSFER"} name="method" onChange={() => setMethod("TRANSFER")} type="radio" /> Transferencia</label>
              </fieldset>
              <label className="field"><span>Número de transacción o referencia</span><input maxLength={120} minLength={3} required value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ej. 000123456" /></label>
              <div className="cash-time-grid">
                <label className="field"><span>Monto pagado (Bs)</span><input inputMode="decimal" pattern="\d{1,10}(\.\d{1,2})?" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                <label className="field"><span>Fecha del pago</span><input max={todayIso()} required type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
              </div>
              <label className="field"><span>Comprobante <small>opcional · imagen o PDF, máx. 2 MB</small></span><input accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></label>
              <button className="primary-button" disabled={saving} type="submit">{saving ? "Enviando…" : "Enviar pago a revisión"}<span aria-hidden="true">↗</span></button>
              <p className="form-note">FARMAXIA verifica el pago y activa tu periodo. Te avisaremos aquí si se rechaza.</p>
            </form>
          ) : (
            <div className="inventory-action-placeholder billing-placeholder">
              <span className="empty-symbol">✦</span>
              <h2>Elige un comprobante</h2>
              <p>Paga por QR o transferencia y luego registra aquí el número de transacción con tu comprobante.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
