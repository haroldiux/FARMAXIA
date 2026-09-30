"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ProcurementNav } from "../../components/procurement-nav";
import { currentSession, type AuthSession } from "../../lib/session";
import {
  listPayables,
  listSupplierPayments,
  paymentMethodLabels,
  registerSupplierPayment,
  schedulePayable,
  type Payable,
  type PayableList,
  type PaymentMethod,
  type ScheduleBucket,
  type SupplierPayment
} from "../../lib/procurement";

const buckets: Array<{ key: Exclude<ScheduleBucket, "paid">; label: string; note: string; tint: string }> = [
  { key: "overdue", label: "Vencidas", note: "ya pasó la fecha", tint: "peach" },
  { key: "thisWeek", label: "Esta semana", note: "próximos 7 días", tint: "sand" },
  { key: "next30", label: "Próximos 30 días", note: "a planificar", tint: "lilac" },
  { key: "later", label: "Más adelante", note: "sin apuro", tint: "mint" }
];

const statusLabels: Record<Payable["status"], string> = { OPEN: "Pendiente", PARTIAL: "Pago parcial", PAID: "Pagada", OVERDUE: "Vencida" };

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" });
}

function money(value: string, currency: string): string {
  const amount = Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "BOB" ? `Bs ${amount}` : `${currency} ${amount}`;
}

function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function PayablesPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [data, setData] = useState<PayableList | null>(null);
  const [filter, setFilter] = useState<"pending" | "paid" | "all">("pending");
  const [selected, setSelected] = useState<Payable | null>(null);
  const [payments, setPayments] = useState<SupplierPayment[] | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("TRANSFER");
  const [reference, setReference] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await listPayables();
    setData(result);
    return result;
  }, []);

  useEffect(() => {
    currentSession()
      .then((value) => {
        setSession(value);
        if (value.permissions.includes("inventory.manage")) {
          load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar las cuentas por pagar."));
        }
      })
      .catch(() => window.location.assign("/"));
  }, [load]);

  function select(payable: Payable): void {
    setSelected(payable);
    setAmount(payable.outstandingAmount === "0.0000" ? "" : Number(payable.outstandingAmount).toFixed(2));
    setPaidOn(today());
    setMethod("TRANSFER");
    setReference("");
    setScheduledOn(payable.scheduledOn ?? "");
    setPayments(null);
    setError(null);
    setNotice(null);
    listSupplierPayments(payable.payableId).then((result) => setPayments(result.items)).catch(() => setPayments([]));
  }

  async function afterChange(message: string, payableId: string): Promise<void> {
    const result = await load();
    const fresh = result.items.find((item) => item.payableId === payableId) ?? null;
    if (fresh) select(fresh);
    setNotice(message);
  }

  async function pay(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const result = await registerSupplierPayment(selected.payableId, { amount: amount.trim(), paidOn, method, reference: reference.trim() || undefined });
      await afterChange(result.status === "PAID" ? "Pago registrado: la factura quedó pagada." : `Pago registrado. Saldo pendiente: ${money(result.outstandingAmount, selected.currency)}.`, selected.payableId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar el pago.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(value: string | null): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await schedulePayable(selected.payableId, value);
      await afterChange(value ? `Pago programado para el ${formatDate(value)}.` : "Se quitó la fecha programada.", selected.payableId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos programar el pago.");
    } finally {
      setSaving(false);
    }
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para ver compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }
  const canPay = session.permissions.includes("payables.manage");
  const items = (data?.items ?? []).filter((item) => filter === "all" || (filter === "paid" ? item.status === "PAID" : item.status !== "PAID"));

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <p className="eyebrow">Compras · Pagos</p>
          <h1>Lo que debes, en orden.</h1>
          <p className="procurement-lede">Registra pagos parciales o totales a tus proveedores y programa cuándo vas a pagar cada factura.</p>
        </div>
      </header>
      <ProcurementNav />
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="payable-buckets" aria-label="Agenda de pagos">
        {buckets.map((bucket) => {
          const rows = data?.totals.filter((total) => total.bucket === bucket.key) ?? [];
          const count = rows.reduce((sum, row) => sum + row.count, 0);
          return (
            <article className={`payable-bucket tint-${bucket.tint}`} key={bucket.key}>
              <span>{bucket.label}</span>
              <strong>{rows.length ? rows.map((row) => money(row.outstanding, row.currency)).join(" · ") : "Bs 0,00"}</strong>
              <small>{count} {count === 1 ? "factura" : "facturas"} · {bucket.note}</small>
            </article>
          );
        })}
      </section>

      <section className="cash-layout">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Cuentas por pagar</p><h2>Facturas de proveedores</h2></div>
            <div className="segmented" role="tablist">
              {([["pending", "Pendientes"], ["paid", "Pagadas"], ["all", "Todas"]] as const).map(([value, label]) => (
                <button aria-selected={filter === value} className={filter === value ? "is-active" : ""} key={value} onClick={() => setFilter(value)} role="tab" type="button">{label}</button>
              ))}
            </div>
          </div>
          {data === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : items.length ? (
            <div className="category-list">
              {items.map((item) => (
                <button className={`category-row payable-row ${selected?.payableId === item.payableId ? "is-selected" : ""}`} key={item.payableId} onClick={() => select(item)} type="button">
                  <div>
                    <strong>{item.supplierName} · Factura {item.invoiceNumber}</strong>
                    <small>
                      Vence {formatDate(item.dueOn)}{item.scheduledOn ? ` · programada ${formatDate(item.scheduledOn)}` : ""} · pagado {money(item.paidAmount, item.currency)} de {money(item.originalAmount, item.currency)}
                    </small>
                  </div>
                  <div className="payable-row-side">
                    <strong>{money(item.outstandingAmount, item.currency)}</strong>
                    <span className={`order-status payable-${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : <div className="catalog-empty"><span>✓</span><h3>{filter === "paid" ? "Todavía no hay facturas pagadas." : "No tienes pagos pendientes."}</h3><p>Las facturas se registran en la pestaña Facturas.</p></div>}
        </article>

        <aside className="panel cash-form-panel">
          {selected ? (
            <>
              <div className="panel-heading"><div><p className="section-kicker">{selected.supplierName}</p><h2>Factura {selected.invoiceNumber}</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setSelected(null)} type="button">×</button></div>
              <div className="sales-estimate"><span>Saldo pendiente</span><strong>{money(selected.outstandingAmount, selected.currency)}</strong><small>De {money(selected.originalAmount, selected.currency)} · vence {formatDate(selected.dueOn)}</small></div>

              {selected.status !== "PAID" && canPay ? (
                <>
                  <form className="cash-form" onSubmit={pay}>
                    <div className="procurement-field-grid">
                      <label className="field"><span>Monto ({selected.currency})</span><input inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                      <label className="field"><span>Fecha de pago</span><input max={today()} required type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
                    </div>
                    <label className="field"><span>Método</span><select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="field"><span>Referencia <small>opcional</small></span><input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="N.º de transferencia o cheque" /></label>
                    <button className="primary-button" disabled={saving} type="submit">{saving ? "Registrando…" : "Registrar pago"}<span>↗</span></button>
                  </form>
                  <form className="cash-form payable-schedule" onSubmit={(event) => { event.preventDefault(); void saveSchedule(scheduledOn || null); }}>
                    <label className="field"><span>Programar pago para</span><input type="date" value={scheduledOn} onChange={(event) => setScheduledOn(event.target.value)} /></label>
                    <div className="user-actions">
                      {selected.scheduledOn ? <button className="row-action" disabled={saving} onClick={() => void saveSchedule(null)} type="button">Quitar fecha</button> : null}
                      <button className="row-action" disabled={saving || !scheduledOn} type="submit">Guardar fecha</button>
                    </div>
                  </form>
                </>
              ) : selected.status !== "PAID" ? <p className="field-hint">Para registrar pagos necesitas el permiso «Registrar pagos a proveedores».</p> : null}

              <div className="payment-history">
                <p className="section-kicker">Historial de pagos</p>
                {payments === null ? <p className="field-hint">Cargando…</p> : payments.length ? payments.map((payment) => (
                  <div className="payment-row" key={payment.id}>
                    <div><strong>{money(payment.amount, selected.currency)}</strong><small>{formatDate(payment.paidOn)} · {paymentMethodLabels[payment.method]}{payment.reference ? ` · ${payment.reference}` : ""}</small></div>
                    <small>{payment.createdByName ?? ""}</small>
                  </div>
                )) : <p className="field-hint">Aún no hay pagos para esta factura.</p>}
              </div>
            </>
          ) : (
            <div className="inventory-action-placeholder">
              <span className="empty-symbol">✦</span>
              <h2>Elige una factura</h2>
              <p>Para registrar un pago, programarlo o ver su historial.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
