"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProcurementNav } from "../../components/procurement-nav";
import { listWarehouses, type Warehouse } from "../../lib/inventory";
import { createPurchaseOrder, listSuppliers, reorderSuggestions, type ReorderSuggestion, type Supplier } from "../../lib/procurement";
import { currentSession, type AuthSession } from "../../lib/session";

interface Choice {
  selected: boolean;
  quantity: string;
  unitCost: string;
}

const coverageOptions = [15, 30, 45, 60];

export default function ReorderPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [coverageDays, setCoverageDays] = useState(30);
  const [items, setItems] = useState<ReorderSuggestion[] | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (days: number) => {
    setItems(null);
    const result = await reorderSuggestions(days);
    setItems(result.items);
    setChoices(Object.fromEntries(result.items.map((item) => [item.presentationId, { selected: true, quantity: String(item.suggestedBase), unitCost: item.averageUnitCost ?? "" }])));
    // Proveedor sugerido: el último al que se le compró el primer producto de la lista.
    const firstSupplier = result.items.find((item) => item.lastSupplierId)?.lastSupplierId;
    if (firstSupplier) setSupplierId((current) => current || firstSupplier);
  }, []);

  useEffect(() => {
    currentSession()
      .then(async (value) => {
        setSession(value);
        if (!value.permissions.includes("inventory.manage")) return;
        const [supplierResult, warehouseResult] = await Promise.all([listSuppliers(), listWarehouses()]);
        setSuppliers(supplierResult.items);
        const dispatch = warehouseResult.items.filter((warehouse) => warehouse.isDispatchEnabled);
        setWarehouses(dispatch.length ? dispatch : warehouseResult.items);
        setWarehouseId((dispatch[0] ?? warehouseResult.items[0])?.id ?? "");
        await load(30);
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.message) setError(reason.message);
        else window.location.assign("/");
      });
  }, [load]);

  function update(presentationId: string, patch: Partial<Choice>): void {
    setChoices((current) => ({ ...current, [presentationId]: { ...current[presentationId]!, ...patch } }));
  }

  async function createOrder(): Promise<void> {
    const lines = (items ?? []).filter((item) => choices[item.presentationId]?.selected).map((item) => {
      const choice = choices[item.presentationId]!;
      return { presentationId: item.presentationId, quantityBase: Number(choice.quantity), unitCost: choice.unitCost.trim() };
    });
    if (!supplierId || !warehouseId) {
      setError("Elige el proveedor y el almacén de destino.");
      return;
    }
    if (!lines.length) {
      setError("Marca al menos un producto.");
      return;
    }
    if (lines.some((line) => !Number.isSafeInteger(line.quantityBase) || line.quantityBase <= 0 || !/^\d+(?:\.\d{1,4})?$/.test(line.unitCost) || Number(line.unitCost) <= 0)) {
      setError("Revisa las cantidades (enteras positivas) y los costos (decimales positivos) de los productos marcados.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createPurchaseOrder({ supplierId, warehouseId, lines });
      setNotice(`Orden creada con ${lines.length} ${lines.length === 1 ? "producto" : "productos"}. La verás en la pestaña Órdenes.`);
      await load(coverageDays);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear la orden.");
    } finally {
      setSaving(false);
    }
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar compras.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }
  const selectedCount = (items ?? []).filter((item) => choices[item.presentationId]?.selected).length;
  const selectedTotal = (items ?? []).reduce((sum, item) => {
    const choice = choices[item.presentationId];
    return choice?.selected ? sum + Number(choice.quantity || 0) * Number(choice.unitCost || 0) : sum;
  }, 0);

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <p className="eyebrow">Compras · Reposición</p>
          <h1>Compra lo que se va a vender.</h1>
          <p className="procurement-lede">Sugerencias según lo vendido en los últimos 30 días, el stock libre de la sucursal y lo que ya está pedido.</p>
        </div>
      </header>
      <ProcurementNav />
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="inventory-toolbar reorder-toolbar">
        <label className="inventory-filter"><span>Cubrir</span>
          <select value={coverageDays} onChange={(event) => { const days = Number(event.target.value); setCoverageDays(days); void load(days).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos calcular la reposición.")); }}>
            {coverageOptions.map((days) => <option key={days} value={days}>{days} días de venta</option>)}
          </select>
        </label>
        <label className="inventory-filter"><span>Proveedor</span>
          <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Selecciona proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
        </label>
        <label className="inventory-filter"><span>Almacén destino</span>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>
        </label>
        <div className="inventory-summary"><strong>{selectedCount.toString().padStart(2, "0")}</strong><span>Bs {selectedTotal.toFixed(2)}</span></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Sugerencias</p><h2>Productos por reponer</h2></div>
          <button className="primary-button reorder-create" disabled={saving || !selectedCount} onClick={() => void createOrder()} type="button">{saving ? "Creando…" : "Crear orden con lo marcado"}<span>↗</span></button>
        </div>
        {items === null ? <div className="inventory-state"><span className="loading-orb" />Calculando…</div> : items.length ? (
          <div className="reorder-table" role="table">
            <div className="reorder-head" role="row"><span /><span>Producto</span><span>Vendido 30 d</span><span>Stock libre</span><span>En camino</span><span>Alcanza</span><span>Pedir</span><span>Costo u.</span></div>
            {items.map((item) => {
              const choice = choices[item.presentationId]!;
              return (
                <div className={`reorder-row ${choice.selected ? "" : "is-off"}`} key={item.presentationId} role="row">
                  <input aria-label={`Incluir ${item.productName}`} checked={choice.selected} onChange={(event) => update(item.presentationId, { selected: event.target.checked })} type="checkbox" />
                  <div><strong>{item.productName}</strong><small>{item.presentationName}{item.lastSupplierName ? ` · último proveedor: ${item.lastSupplierName}` : ""}</small></div>
                  <span data-label="Vendido 30 d">{item.soldBase} u. <small>({item.averageDailyBase}/día)</small></span>
                  <span data-label="Stock libre">{item.availableBase} u.</span>
                  <span data-label="En camino">{item.incomingBase} u.</span>
                  <span data-label="Alcanza"><span className={`order-status ${item.daysOfStock !== null && item.daysOfStock < 7 ? "payable-overdue" : "payable-partial"}`}>{item.daysOfStock === null ? "—" : `${item.daysOfStock} días`}</span></span>
                  <label data-label="Pedir"><input aria-label={`Cantidad de ${item.productName}`} min="1" type="number" value={choice.quantity} onChange={(event) => update(item.presentationId, { quantity: event.target.value })} /></label>
                  <label data-label="Costo u."><input aria-label={`Costo de ${item.productName}`} inputMode="decimal" placeholder="0.0000" value={choice.unitCost} onChange={(event) => update(item.presentationId, { unitCost: event.target.value })} /></label>
                </div>
              );
            })}
          </div>
        ) : <div className="catalog-empty"><span>✓</span><h3>No hace falta reponer nada.</h3><p>Con el stock libre y lo ya pedido alcanza para {coverageDays} días de venta.</p></div>}
        <p className="field-hint reorder-note">Cantidades en unidades base. El costo sugerido es el costo promedio ponderado de cada producto.</p>
      </section>
    </main>
  );
}
