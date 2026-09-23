"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, logout, type AuthSession } from "../../lib/session";
import {
  createSupplierInvoice,
  listGoodsReceipts,
  listSupplierInvoices,
  listSuppliers,
  procurementIdempotencyKey,
  type GoodsReceipt,
  type Supplier,
  type SupplierInvoice
} from "../../lib/procurement";

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("es-BO", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
  });
}

function statusLabel(status: SupplierInvoice["status"]): string {
  if (status === "PAID") return "Pagada";
  if (status === "OVERDUE") return "Vencida";
  return "Abierta";
}

export default function SupplierInvoicesPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [goodsReceiptId, setGoodsReceiptId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(new Date().toISOString().slice(0, 10));
  const [dueOn, setDueOn] = useState(new Date().toISOString().slice(0, 10));
  const [totalAmount, setTotalAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [supplierResult, receiptResult, invoiceResult] = await Promise.all([
      listSuppliers(), listGoodsReceipts(), listSupplierInvoices()
    ]);
    setSuppliers(supplierResult.items);
    setReceipts(receiptResult.items);
    setInvoices(invoiceResult.items);
    setSupplierId((current) => current || supplierResult.items[0]?.id || "");
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      try {
        const value = await currentSession();
        if (!mounted) return;
        setSession(value);
        if (!value.permissions.includes("inventory.manage")) return;
        await refresh();
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "No pudimos cargar cuentas por pagar.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => { mounted = false; };
  }, []);

  const visibleReceipts = receipts.filter((receipt) => !supplierId || receipt.supplierId === supplierId);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!supplierId || !goodsReceiptId || !invoiceNumber.trim() || !issuedOn || !dueOn
      || !/^\d+(?:\.\d{1,4})?$/.test(totalAmount) || Number(totalAmount) <= 0) {
      setError("Completa proveedor, recepción, número, fechas y un total decimal positivo.");
      return;
    }
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await createSupplierInvoice({
        idempotencyKey: procurementIdempotencyKey(), supplierId, goodsReceiptId,
        invoiceNumber: invoiceNumber.trim(), issuedOn, currency: "BOB", totalAmount, dueOn
      });
      await refresh();
      setInvoiceNumber(""); setTotalAmount(""); setNotice(`Factura ${result.invoiceId.slice(0, 8)}… registrada.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar la factura.");
    } finally { setSaving(false); }
  }

  async function signOut(): Promise<void> { await logout(); window.location.assign("/"); }

  if (loading) return <main className="center-state"><span className="loading-orb" />Cargando cuentas por pagar…</main>;
  if (!session) return null;
  if (!session.permissions.includes("inventory.manage")) return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;

  return <main className="receiving-page">
    <header className="procurement-header"><div><Link className="back-link" href="/procurement">← Volver a compras</Link><p className="eyebrow">F10 · Cuentas por pagar</p><h1>Facturas bajo control.</h1><p className="procurement-lede">Relaciona cada factura con una recepción y conserva sus importes exactos.</p></div><button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button></header>
    {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
    {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}
    <section className="receiving-layout">
      <section className="panel receiving-form-panel"><div className="panel-heading"><div><p className="section-kicker">Nueva factura</p><h2>Registrar cuenta</h2></div></div>
        {!visibleReceipts.length ? <div className="procurement-empty"><span className="empty-symbol">✓</span><h3>No hay recepciones disponibles.</h3><p>Registra una recepción antes de asociar una factura.</p></div> : <form className="receiving-form" onSubmit={submit}>
          <label className="field"><span>Proveedor</span><select required value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setGoodsReceiptId(""); }}><option value="">Selecciona proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label className="field"><span>Recepción</span><select required value={goodsReceiptId} onChange={(event) => setGoodsReceiptId(event.target.value)}><option value="">Selecciona recepción</option>{visibleReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.supplierName} · {new Date(receipt.receivedAt).toLocaleDateString("es-BO")} · {receipt.id.slice(0, 8)}</option>)}</select></label>
          <label className="field"><span>Número de factura</span><input maxLength={80} required value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Ej. FC-001-000123" /></label>
          <div className="receiving-field-grid"><label className="field"><span>Fecha de emisión</span><input required type="date" value={issuedOn} onChange={(event) => setIssuedOn(event.target.value)} /></label><label className="field"><span>Vencimiento</span><input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label></div>
          <label className="field"><span>Total (BOB)</span><input inputMode="decimal" required value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} placeholder="0.0000" /></label>
          <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Registrar factura"}<span>↗</span></button>
          <p className="form-note">Esta versión registra el saldo inicial. Pagos y conciliación quedan fuera de este alcance.</p>
        </form>}
      </section>
      <section className="panel receiving-order-panel"><div className="panel-heading"><div><p className="section-kicker">Antigüedad</p><h2>Facturas registradas</h2></div><span className="panel-count">{invoices.length.toString().padStart(2, "0")}</span></div>
        {!invoices.length ? <div className="procurement-empty"><span className="empty-symbol">✦</span><h3>Aún no hay facturas.</h3><p>Las facturas aparecerán aquí luego de asociarlas a una recepción.</p></div> : <div className="order-list">{invoices.map((invoice) => <article className="order-card" key={invoice.invoiceId}><div className="order-card-head"><div><strong>{invoice.supplierName}</strong><small>{invoice.invoiceNumber} · Emitida {dateLabel(invoice.issuedOn)}</small></div><span className={`order-status order-${invoice.status.toLowerCase()}`}>{statusLabel(invoice.status)}</span></div><div className="order-lines"><div className="order-line"><span>Saldo pendiente</span><strong>{invoice.currency} {invoice.outstandingAmount}</strong></div><div className="order-line"><span>Vencimiento</span><small>{dateLabel(invoice.dueOn)}</small></div></div><p className="order-id">Factura {invoice.invoiceId.slice(0, 8)}… · Recepción {invoice.goodsReceiptId?.slice(0, 8) ?? "—"}</p></article>)}</div>}
      </section>
    </section>
  </main>;
}
