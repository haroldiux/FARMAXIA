
"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, logout, type AuthSession } from "../lib/session";
import { listWarehouses, type Warehouse } from "../lib/inventory";
import {
  createPurchaseOrder,
  createSupplier,
  listPresentations,
  listPurchaseOrders,
  listSuppliers,
  type Presentation,
  type PurchaseOrder,
  type Supplier
} from "../lib/procurement";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function statusLabel(status: string): string {
  if (status === "RECEIVED") return "Recibida";
  if (status === "PARTIALLY_RECEIVED") return "Recepción parcial";
  return status === "CANCELED" ? "Cancelada" : "Enviada";
}

export default function ProcurementPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [orderSupplierId, setOrderSupplierId] = useState("");
  const [orderWarehouseId, setOrderWarehouseId] = useState("");
  const [orderPresentationId, setOrderPresentationId] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderUnitCost, setOrderUnitCost] = useState("");

  async function refresh(): Promise<void> {
    const [warehouseResult, supplierResult, presentationResult, orderResult] = await Promise.all([
      listWarehouses(),
      listSuppliers(),
      listPresentations(),
      listPurchaseOrders()
    ]);
    setWarehouses(warehouseResult.items);
    setSuppliers(supplierResult.items);
    setPresentations(presentationResult.items);
    setOrders(orderResult.items);
    setOrderWarehouseId((value) => value || warehouseResult.items[0]?.id || "");
    setOrderSupplierId((value) => value || supplierResult.items[0]?.id || "");
    setOrderPresentationId((value) => value || presentationResult.items[0]?.presentationId || "");
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      let value: AuthSession;
      try {
        value = await currentSession();
      } catch {
        if (mounted) {
          window.location.assign("/");
        }
        return;
      }
      if (!mounted) {
        return;
      }
      setSession(value);
      if (!value.permissions.includes("inventory.manage")) {
        setLoading(false);
        return;
      }
      try {
        await refresh();
      } catch (reasonValue) {
        if (mounted) {
          setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar compras.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  async function submitSupplier(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createSupplier({ name: supplierName.trim(), taxId: supplierTaxId.trim() || undefined });
      setSupplierName("");
      setSupplierTaxId("");
      await refresh();
      setNotice("Proveedor registrado y disponible para nuevas órdenes.");
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos registrar el proveedor.");
    } finally {
      setSaving(false);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const quantity = Number(orderQuantity);
    if (!orderSupplierId || !orderWarehouseId || !orderPresentationId) {
      setError("Selecciona proveedor, almacén y presentación antes de crear la orden.");
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !/^\d+(?:\.\d{1,4})?$/.test(orderUnitCost) || Number(orderUnitCost) <= 0) {
      setError("La cantidad debe ser entera positiva y el costo un decimal positivo.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createPurchaseOrder({
        supplierId: orderSupplierId,
        warehouseId: orderWarehouseId,
        lines: [{ presentationId: orderPresentationId, quantityBase: quantity, unitCost: orderUnitCost }]
      });
      await refresh();
      setOrderQuantity("1");
      setOrderUnitCost("");
      setNotice("Orden creada. Ya puedes registrar su recepción por lote.");
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos crear la orden.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut(): Promise<void> {
    await logout();
    window.location.assign("/");
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando compras…</main>;
  }
  if (!session) {
    return null;
  }
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">F4 · Compras</p>
          <h1>Abastecer bien también es cuidar.</h1>
          <p className="procurement-lede">Prepara proveedores y órdenes de compra con el mismo contexto de sucursal que protege tu inventario.</p>
        </div>
        <button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button>
      </header>

      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="procurement-layout">
        <article className="procurement-orders panel">
          <div className="panel-heading"><div><p className="section-kicker">Ordenes de compra</p><h2>Abastecimiento en curso</h2></div><div><Link className="row-action" href="/procurement/invoices">Ver facturas</Link><span className="panel-count">{orders.length.toString().padStart(2, "0")}</span></div></div>
          {orders.length ? <div className="order-list">{orders.map((order) => <article className="order-card" key={order.id}>
            <div className="order-card-head"><div><strong>{order.supplierName}</strong><small>{order.warehouseName} · {formatDate(order.orderedAt)}</small></div><span className={`order-status order-${order.status.toLowerCase()}`}>{statusLabel(order.status)}</span></div>
            <div className="order-lines">{order.lines.map((line) => <div className="order-line" key={`${order.id}-${line.presentationId}`}><span>{line.productName} · {line.presentationName}</span><strong>{line.quantityBase} u.</strong><small>BOB {line.unitCost}</small></div>)}</div>
            <div className="order-card-foot"><p className="order-id">Orden {order.id.slice(0, 8)}…</p>{order.status !== "RECEIVED" && order.status !== "CANCELED" ? <Link className="row-action" href="/procurement/receiving">Recibir lotes</Link> : null}</div>
          </article>)}</div> : <div className="procurement-empty"><span className="empty-symbol">✦</span><h3>Aún no hay órdenes.</h3><p>Crea la primera para preparar la recepción de mercadería.</p></div>}
        </article>

        <div className="procurement-side">
          <aside className="panel procurement-form-panel"><div className="panel-heading"><div><p className="section-kicker">Alta rápida</p><h2>Nuevo proveedor</h2></div><span className="sparkle">✦</span></div><form className="procurement-form" onSubmit={submitSupplier}>
            <label className="field"><span>Nombre comercial</span><input required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Ej. Distribuidora Nacional" /></label>
            <label className="field"><span>NIT <small>opcional</small></span><input value={supplierTaxId} onChange={(event) => setSupplierTaxId(event.target.value)} placeholder="Ej. 10203040" /></label>
            <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Registrar proveedor"}<span>↗</span></button>
          </form></aside>

          <aside className="panel procurement-form-panel"><div className="panel-heading"><div><p className="section-kicker">Abastecimiento</p><h2>Nueva orden</h2></div><span className="panel-count">01</span></div><form className="procurement-form" onSubmit={submitOrder}>
            <label className="field"><span>Proveedor</span><select required value={orderSupplierId} onChange={(event) => setOrderSupplierId(event.target.value)}><option value="">Selecciona proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="field"><span>Almacén destino</span><select required value={orderWarehouseId} onChange={(event) => setOrderWarehouseId(event.target.value)}><option value="">Selecciona almacén</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
            <label className="field"><span>Producto y presentación</span><select required value={orderPresentationId} onChange={(event) => setOrderPresentationId(event.target.value)}><option value="">Selecciona presentación</option>{presentations.map((presentation) => <option key={presentation.presentationId} value={presentation.presentationId}>{presentation.productName} · {presentation.presentationName}</option>)}</select></label>
            <div className="procurement-field-grid"><label className="field"><span>Cantidad base</span><input min="1" required type="number" value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value)} /></label><label className="field"><span>Costo unitario</span><input required type="text" inputMode="decimal" value={orderUnitCost} onChange={(event) => setOrderUnitCost(event.target.value)} placeholder="0.0000" /></label></div>
            <button className="primary-button" disabled={saving || !suppliers.length || !presentations.length} type="submit">{saving ? "Creando…" : "Crear orden"}<span>↗</span></button>
            <p className="form-note">Esta vista crea una línea por orden. Puedes dividir su recepción física en varios lotes.</p>
          </form></aside>
        </div>
      </section>
    </main>
  );
}
