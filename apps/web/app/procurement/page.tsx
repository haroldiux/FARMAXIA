"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ProcurementNav } from "../components/procurement-nav";
import { currentSession, type AuthSession } from "../lib/session";
import { listWarehouses, type Warehouse } from "../lib/inventory";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  listCosts,
  listPresentations,
  listPurchaseOrders,
  listSuppliers,
  type Presentation,
  type PurchaseOrder,
  type Supplier
} from "../lib/procurement";

interface DraftLine {
  presentationId: string;
  quantity: string;
  unitCost: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" });
}

function statusLabel(status: string): string {
  if (status === "RECEIVED") return "Recibida";
  if (status === "PARTIALLY_RECEIVED") return "Recepción parcial";
  if (status === "CLOSED") return "Saldo cerrado";
  return status === "CANCELED" ? "Cancelada" : "Enviada";
}

const emptyLine = (): DraftLine => ({ presentationId: "", quantity: "1", unitCost: "" });

export default function ProcurementPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [averageCosts, setAverageCosts] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [orderSupplierId, setOrderSupplierId] = useState("");
  const [orderWarehouseId, setOrderWarehouseId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [closing, setClosing] = useState<{ orderId: string; reason: string } | null>(null);

  async function refresh(): Promise<void> {
    const [warehouseResult, supplierResult, presentationResult, orderResult, costResult] = await Promise.all([
      listWarehouses(),
      listSuppliers(),
      listPresentations(),
      listPurchaseOrders(),
      listCosts().catch(() => ({ items: [] }))
    ]);
    setWarehouses(warehouseResult.items);
    setSuppliers(supplierResult.items);
    setPresentations(presentationResult.items);
    setOrders(orderResult.items);
    setAverageCosts(Object.fromEntries(costResult.items.map((item) => [item.presentationId, item.averageUnitCost])));
    setOrderWarehouseId((value) => value || warehouseResult.items[0]?.id || "");
    setOrderSupplierId((value) => value || supplierResult.items[0]?.id || "");
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
        await refresh();
      } catch (reasonValue) {
        if (mounted) setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar compras.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos completar la operación.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitSupplier(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const ok = await run(() => createSupplier({ name: supplierName.trim(), taxId: supplierTaxId.trim() || undefined }), "Proveedor registrado y disponible para nuevas órdenes.");
    if (ok) {
      setSupplierName("");
      setSupplierTaxId("");
    }
  }

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      // Al elegir un producto se sugiere su costo promedio vigente.
      if (patch.presentationId && !line.unitCost && averageCosts[patch.presentationId]) {
        next.unitCost = averageCosts[patch.presentationId]!;
      }
      return next;
    }));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!orderSupplierId || !orderWarehouseId) {
      setError("Selecciona proveedor y almacén antes de crear la orden.");
      return;
    }
    const used = new Set<string>();
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!line.presentationId) {
        setError("Elige el producto de cada línea.");
        return;
      }
      if (used.has(line.presentationId)) {
        setError("Un producto no puede repetirse en la misma orden; suma las cantidades en una línea.");
        return;
      }
      used.add(line.presentationId);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || !/^\d+(?:\.\d{1,4})?$/.test(line.unitCost) || Number(line.unitCost) <= 0) {
        setError("En cada línea la cantidad debe ser entera positiva y el costo un decimal positivo.");
        return;
      }
    }
    const ok = await run(() => createPurchaseOrder({
      supplierId: orderSupplierId,
      warehouseId: orderWarehouseId,
      lines: lines.map((line) => ({ presentationId: line.presentationId, quantityBase: Number(line.quantity), unitCost: line.unitCost }))
    }), `Orden creada con ${lines.length} ${lines.length === 1 ? "producto" : "productos"}. Ya puedes registrar su recepción por lote.`);
    if (ok) setLines([emptyLine()]);
  }

  async function confirmClose(order: PurchaseOrder): Promise<void> {
    if (!closing) return;
    const ok = await run(
      () => cancelPurchaseOrder(order.id, closing.reason.trim()),
      order.status === "PARTIALLY_RECEIVED" ? "Saldo pendiente cerrado. Lo ya recibido se mantiene." : "Orden cancelada."
    );
    if (ok) setClosing(null);
  }

  const estimatedTotal = lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);
    return Number.isFinite(quantity) && Number.isFinite(cost) ? sum + quantity * cost : sum;
  }, 0);

  if (loading) return <main className="center-state"><span className="loading-orb" />Cargando compras…</main>;
  if (!session) return null;
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <p className="eyebrow">Compras · Órdenes</p>
          <h1>Abastecer bien también es cuidar.</h1>
          <p className="procurement-lede">Arma órdenes con varios productos, sigue lo que ya llegó y cancela o cierra lo que no se va a recibir.</p>
        </div>
      </header>
      <ProcurementNav />

      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="procurement-layout">
        <article className="procurement-orders panel">
          <div className="panel-heading"><div><p className="section-kicker">Órdenes de compra</p><h2>Abastecimiento en curso</h2></div><span className="panel-count">{orders.length.toString().padStart(2, "0")}</span></div>
          {orders.length ? <div className="order-list">{orders.map((order) => {
            const open = order.status === "SUBMITTED" || order.status === "PARTIALLY_RECEIVED";
            return (
              <article className="order-card" key={order.id}>
                <div className="order-card-head"><div><strong>{order.supplierName}</strong><small>{order.warehouseName} · {formatDate(order.orderedAt)}</small></div><span className={`order-status order-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span></div>
                <div className="order-lines">{order.lines.map((line) => (
                  <div className="order-line" key={`${order.id}-${line.presentationId}`}>
                    <span>{line.productName} · {line.presentationName}</span>
                    <strong>{line.receivedBase}/{line.quantityBase} u.</strong>
                    <small>Bs {line.unitCost} c/u · recibido {line.receivedBase} de {line.quantityBase}</small>
                  </div>
                ))}</div>
                {order.closeReason ? <p className="form-note order-close-note">Motivo: {order.closeReason}</p> : null}
                {closing?.orderId === order.id ? (
                  <form className="order-close-form" onSubmit={(event) => { event.preventDefault(); void confirmClose(order); }}>
                    <label className="field"><span>{order.status === "PARTIALLY_RECEIVED" ? "¿Por qué se cierra el saldo pendiente?" : "¿Por qué se cancela la orden?"}</span>
                      <input autoFocus maxLength={255} minLength={3} required value={closing.reason} onChange={(event) => setClosing({ orderId: order.id, reason: event.target.value })} placeholder="Ej. El proveedor no tiene stock" />
                    </label>
                    <div className="user-actions">
                      <button className="row-action" onClick={() => setClosing(null)} type="button">Volver</button>
                      <button className="row-action row-action-danger" disabled={saving} type="submit">{order.status === "PARTIALLY_RECEIVED" ? "Cerrar saldo" : "Cancelar orden"}</button>
                    </div>
                  </form>
                ) : (
                  <div className="order-card-foot">
                    <p className="order-id">Orden {order.id.slice(0, 8)}…</p>
                    {open ? (
                      <div className="user-actions">
                        <button className="row-action row-action-danger" onClick={() => setClosing({ orderId: order.id, reason: "" })} type="button">{order.status === "PARTIALLY_RECEIVED" ? "Cerrar saldo" : "Cancelar"}</button>
                        <Link className="row-action" href="/procurement/receiving">Recibir lotes</Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}</div> : <div className="procurement-empty"><span className="empty-symbol">✦</span><h3>Aún no hay órdenes.</h3><p>Crea la primera para preparar la recepción de mercadería.</p></div>}
        </article>

        <div className="procurement-side">
          <aside className="panel procurement-form-panel">
            <div className="panel-heading"><div><p className="section-kicker">Abastecimiento</p><h2>Nueva orden</h2></div><span className="panel-count">{lines.length.toString().padStart(2, "0")}</span></div>
            <form className="procurement-form" onSubmit={submitOrder}>
              <label className="field"><span>Proveedor</span><select required value={orderSupplierId} onChange={(event) => setOrderSupplierId(event.target.value)}><option value="">Selecciona proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="field"><span>Almacén destino</span><select required value={orderWarehouseId} onChange={(event) => setOrderWarehouseId(event.target.value)}><option value="">Selecciona almacén</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
              <div className="order-draft-lines">
                {lines.map((line, index) => (
                  <div className="order-draft-line" key={index}>
                    <label className="field"><span>Producto {index + 1}</span>
                      <select required value={line.presentationId} onChange={(event) => updateLine(index, { presentationId: event.target.value })}>
                        <option value="">Selecciona presentación</option>
                        {presentations.map((presentation) => <option key={presentation.presentationId} value={presentation.presentationId}>{presentation.productName} · {presentation.presentationName}</option>)}
                      </select>
                    </label>
                    <div className="procurement-field-grid">
                      <label className="field"><span>Cantidad base</span><input min="1" required type="number" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                      <label className="field"><span>Costo unitario (Bs){averageCosts[line.presentationId] ? <small> · prom. {averageCosts[line.presentationId]}</small> : null}</span><input required type="text" inputMode="decimal" value={line.unitCost} onChange={(event) => updateLine(index, { unitCost: event.target.value })} placeholder="0.0000" /></label>
                    </div>
                    {lines.length > 1 ? <button className="row-action row-action-danger" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} type="button">Quitar línea</button> : null}
                  </div>
                ))}
              </div>
              <button className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine()])} type="button">+ Agregar producto</button>
              <p className="order-draft-total"><span>Total estimado</span><strong>Bs {estimatedTotal.toFixed(2)}</strong></p>
              <button className="primary-button" disabled={saving || !suppliers.length || !presentations.length} type="submit">{saving ? "Creando…" : "Crear orden"}<span>↗</span></button>
            </form>
          </aside>

          <aside className="panel procurement-form-panel">
            <div className="panel-heading"><div><p className="section-kicker">Alta rápida</p><h2>Nuevo proveedor</h2></div><span className="sparkle">✦</span></div>
            <form className="procurement-form" onSubmit={submitSupplier}>
              <label className="field"><span>Nombre comercial</span><input required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Ej. Distribuidora Nacional" /></label>
              <label className="field"><span>NIT <small>opcional</small></span><input value={supplierTaxId} onChange={(event) => setSupplierTaxId(event.target.value)} placeholder="Ej. 10203040" /></label>
              <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Registrar proveedor"}<span>↗</span></button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
