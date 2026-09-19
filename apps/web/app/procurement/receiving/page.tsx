"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { currentSession, logout, type AuthSession } from "../../lib/session";
import {
  listPurchaseOrders,
  procurementIdempotencyKey,
  receivePurchaseOrder,
  type PurchaseOrder
} from "../../lib/procurement";

interface ReceiptDraftLine {
  presentationId: string;
  lotCode: string;
  expiresOn: string;
  quantityBase: string;
  unitCost: string;
}

function localDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function draftLine(order: PurchaseOrder): ReceiptDraftLine {
  const line = order.lines[0];
  return {
    presentationId: line?.presentationId ?? "",
    lotCode: "",
    expiresOn: "",
    quantityBase: "1",
    unitCost: line?.unitCost ?? ""
  };
}

function statusLabel(status: string): string {
  return status === "PARTIALLY_RECEIVED" ? "Recepción parcial" : "Pendiente";
}

export default function ReceivingPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [receivedAt, setReceivedAt] = useState(localDateTime);
  const [lines, setLines] = useState<ReceiptDraftLine[]>([]);
  const [requestKey, setRequestKey] = useState(procurementIdempotencyKey);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const receivableOrders = useMemo(
    () => orders.filter((order) => order.status !== "CANCELED" && order.status !== "RECEIVED"),
    [orders]
  );
  const selectedOrder = receivableOrders.find((order) => order.id === selectedOrderId) ?? null;

  async function refreshOrders(): Promise<void> {
    const result = await listPurchaseOrders();
    setOrders(result.items);
    setSelectedOrderId((current) => {
      const stillReceivable = result.items.some(
        (order) => order.id === current && order.status !== "CANCELED" && order.status !== "RECEIVED"
      );
      return stillReceivable ? current : "";
    });
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      let value: AuthSession;
      try {
        value = await currentSession();
      } catch {
        if (mounted) window.location.assign("/");
        return;
      }
      if (!mounted) return;
      setSession(value);
      if (!value.permissions.includes("inventory.manage")) {
        setLoading(false);
        return;
      }
      try {
        await refreshOrders();
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "No pudimos cargar las órdenes.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  function chooseOrder(orderId: string): void {
    const order = receivableOrders.find((candidate) => candidate.id === orderId);
    setSelectedOrderId(orderId);
    setLines(order ? [draftLine(order)] : []);
    setRequestKey(procurementIdempotencyKey());
    setError(null);
    setNotice(null);
  }

  function updateReceivedAt(value: string): void {
    setReceivedAt(value);
    setRequestKey(procurementIdempotencyKey());
  }

  function updateLine(index: number, field: keyof ReceiptDraftLine, value: string): void {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, [field]: value } : line
    )));
    setRequestKey(procurementIdempotencyKey());
  }

  function addLine(): void {
    if (!selectedOrder) return;
    setLines((current) => [...current, draftLine(selectedOrder)]);
    setRequestKey(procurementIdempotencyKey());
  }

  function removeLine(index: number): void {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
    setRequestKey(procurementIdempotencyKey());
  }

  async function submitReceipt(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedOrder || lines.length === 0) {
      setError("Selecciona una orden y registra al menos un lote.");
      return;
    }
    const invalidLine = lines.some((line) => {
      const quantity = Number(line.quantityBase);
      return !line.presentationId || !line.lotCode.trim() || !line.expiresOn
        || !Number.isSafeInteger(quantity) || quantity <= 0
        || !/^\d+(?:\.\d{1,4})?$/.test(line.unitCost) || Number(line.unitCost) <= 0;
    });
    if (invalidLine) {
      setError("Completa cada lote con vencimiento, cantidad entera positiva y costo decimal positivo.");
      return;
    }
    const duplicateKeys = new Set<string>();
    for (const line of lines) {
      const key = `${line.presentationId}:${line.lotCode.trim()}`;
      if (duplicateKeys.has(key)) {
        setError("No repitas el mismo lote para una presentación dentro de la recepción.");
        return;
      }
      duplicateKeys.add(key);
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await receivePurchaseOrder({
        idempotencyKey: requestKey,
        supplierId: selectedOrder.supplierId,
        purchaseOrderId: selectedOrder.id,
        warehouseId: selectedOrder.warehouseId,
        receivedAt: new Date(receivedAt).toISOString(),
        lines: lines.map((line) => ({
          presentationId: line.presentationId,
          lotCode: line.lotCode.trim(),
          expiresOn: line.expiresOn,
          quantityBase: Number(line.quantityBase),
          unitCost: line.unitCost
        }))
      });
      setNotice(`Recepción ${result.receiptId.slice(0, 8)}… registrada con ${result.lineCount} lote${result.lineCount === 1 ? "" : "s"}.`);
      await refreshOrders();
      setLines([]);
      setReceivedAt(localDateTime());
      setRequestKey(procurementIdempotencyKey());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar la recepción.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut(): Promise<void> {
    await logout();
    window.location.assign("/");
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando recepción…</main>;
  }
  if (!session) return null;
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para recibir compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="receiving-page">
      <header className="procurement-header">
        <div>
          <Link className="back-link" href="/procurement">← Volver a compras</Link>
          <p className="eyebrow">F5 · Recepción por lote</p>
          <h1>Cada lote entra con historia.</h1>
          <p className="procurement-lede">Registra vencimiento, cantidad y costo provisional sin superar lo ordenado.</p>
        </div>
        <button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button>
      </header>

      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="receiving-layout">
        <aside className="panel receiving-order-panel">
          <div className="panel-heading"><div><p className="section-kicker">Orden destino</p><h2>Compra pendiente</h2></div><span className="panel-count">{receivableOrders.length.toString().padStart(2, "0")}</span></div>
          <label className="field"><span>Orden de compra</span><select value={selectedOrderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">Selecciona una orden</option>{receivableOrders.map((order) => <option key={order.id} value={order.id}>{order.supplierName} · {order.warehouseName} · {order.id.slice(0, 8)}</option>)}</select></label>
          {selectedOrder ? <div className="receiving-order-summary"><span className={`order-status order-${selectedOrder.status.toLowerCase()}`}>{statusLabel(selectedOrder.status)}</span><strong>{selectedOrder.supplierName}</strong><small>{selectedOrder.warehouseName}</small>{selectedOrder.lines.map((line) => <div key={line.presentationId}><span>{line.productName} · {line.presentationName}</span><b>{line.quantityBase} u. ordenadas</b></div>)}</div> : <p className="empty-copy">Selecciona una orden pendiente para habilitar sus presentaciones.</p>}
        </aside>

        <section className="panel receiving-form-panel">
          <div className="panel-heading"><div><p className="section-kicker">Ingreso físico</p><h2>Lotes recibidos</h2></div><button className="row-action" disabled={!selectedOrder} onClick={addLine} type="button">+ Agregar lote</button></div>
          {!receivableOrders.length ? <div className="procurement-empty"><span className="empty-symbol">✓</span><h3>No hay órdenes pendientes.</h3><p>Crea una orden nueva o revisa las recepciones completadas.</p></div> : <form className="receiving-form" onSubmit={submitReceipt}>
            <label className="field receiving-date"><span>Fecha y hora de recepción</span><input required type="datetime-local" value={receivedAt} onChange={(event) => updateReceivedAt(event.target.value)} /></label>
            <div className="receiving-lines">{lines.map((line, index) => <article className="receiving-line" key={index}>
              <div className="receiving-line-head"><strong>Lote {String(index + 1).padStart(2, "0")}</strong><button aria-label={`Quitar lote ${index + 1}`} disabled={lines.length === 1} onClick={() => removeLine(index)} type="button">×</button></div>
              <label className="field"><span>Presentación</span><select required value={line.presentationId} onChange={(event) => updateLine(index, "presentationId", event.target.value)}><option value="">Selecciona presentación</option>{selectedOrder?.lines.map((orderLine) => <option key={orderLine.presentationId} value={orderLine.presentationId}>{orderLine.productName} · {orderLine.presentationName}</option>)}</select></label>
              <div className="receiving-field-grid"><label className="field"><span>Código de lote</span><input maxLength={100} required value={line.lotCode} onChange={(event) => updateLine(index, "lotCode", event.target.value)} placeholder="Ej. LOT-2026-01" /></label><label className="field"><span>Vencimiento</span><input required type="date" value={line.expiresOn} onChange={(event) => updateLine(index, "expiresOn", event.target.value)} /></label></div>
              <div className="receiving-field-grid"><label className="field"><span>Cantidad base</span><input min="1" required type="number" value={line.quantityBase} onChange={(event) => updateLine(index, "quantityBase", event.target.value)} /></label><label className="field"><span>Costo unitario</span><input inputMode="decimal" required value={line.unitCost} onChange={(event) => updateLine(index, "unitCost", event.target.value)} placeholder="0.0000" /></label></div>
            </article>)}</div>
            <button className="primary-button" disabled={saving || !selectedOrder || !lines.length} type="submit">{saving ? "Registrando…" : "Registrar recepción"}<span>↗</span></button>
            <p className="form-note">Si la conexión falla, vuelve a enviar sin cambiar los datos: la clave idempotente evita duplicar inventario.</p>
          </form>}
        </section>
      </section>
    </main>
  );
}
