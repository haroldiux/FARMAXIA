"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, type AuthSession } from "../lib/session";
import {
  listTransfers,
  lookupStock,
  lookupWarehouses,
  requestTransfer,
  type Transfer,
  type TransferStatus,
  type TransferStockLookupItem,
  type TransferWarehouseOption
} from "../lib/transfers";

interface DraftItem {
  stockKey: string;
  quantity: string;
}

const statusLabels: Record<TransferStatus, string> = {
  REQUESTED: "Solicitado",
  APPROVED: "Aprobado",
  DISPATCHED: "Despachado",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibido",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado"
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" });
}

function stockKey(item: TransferStockLookupItem): string {
  return `${item.presentationId}::${item.batchId}`;
}

const emptyItem = (): DraftItem => ({ stockKey: "", quantity: "1" });

export default function TransfersPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<TransferWarehouseOption[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stockOptions, setStockOptions] = useState<TransferStockLookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [originWarehouseId, setOriginWarehouseId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  async function refresh(): Promise<void> {
    const [warehouseResult, transferResult] = await Promise.all([lookupWarehouses(), listTransfers()]);
    setWarehouses(warehouseResult.items);
    setTransfers(transferResult.items);
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
      if (!value.permissions.includes("transfers.manage")) {
        setLoading(false);
        return;
      }
      try {
        await refresh();
      } catch (reasonValue) {
        if (mounted) setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar traspasos.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  // El stock disponible depende del almacén de origen elegido.
  useEffect(() => {
    if (!originWarehouseId) {
      setStockOptions([]);
      return;
    }
    let mounted = true;
    lookupStock(originWarehouseId)
      .then((result) => mounted && setStockOptions(result.items))
      .catch(() => mounted && setStockOptions([]));
    return () => {
      mounted = false;
    };
  }, [originWarehouseId]);

  function warehouseName(id: string): string {
    const match = warehouses.find((warehouse) => warehouse.id === id);
    if (!match) return "Almacén";
    return match.branchName ? `${match.name} · ${match.branchName}` : match.name;
  }

  function updateItem(index: number, patch: Partial<DraftItem>): void {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!originWarehouseId || !destinationWarehouseId) {
      setError("Selecciona almacén de origen y destino.");
      return;
    }
    if (originWarehouseId === destinationWarehouseId) {
      setError("El almacén de origen y el de destino deben ser distintos.");
      return;
    }
    const usedKeys = new Set<string>();
    const payloadItems: Array<{ presentationId: string; batchId: string; requestedQty: number }> = [];
    for (const item of items) {
      if (!item.stockKey) {
        setError("Elige el producto/lote de cada ítem.");
        return;
      }
      if (usedKeys.has(item.stockKey)) {
        setError("Un mismo lote no puede repetirse en el traspaso.");
        return;
      }
      usedKeys.add(item.stockKey);
      const stock = stockOptions.find((option) => stockKey(option) === item.stockKey);
      const quantity = Number(item.quantity);
      if (!stock || !Number.isSafeInteger(quantity) || quantity <= 0) {
        setError("La cantidad de cada ítem debe ser un entero positivo.");
        return;
      }
      if (quantity > stock.availableQty) {
        setError(`La cantidad solicitada supera el stock disponible (${stock.availableQty}).`);
        return;
      }
      payloadItems.push({ presentationId: stock.presentationId, batchId: stock.batchId, requestedQty: quantity });
    }

    setSaving(true);
    try {
      await requestTransfer({ originWarehouseId, destinationWarehouseId, items: payloadItems });
      await refresh();
      setNotice("Traspaso solicitado. Ya puedes seguir su estado en la lista.");
      setItems([emptyItem()]);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos solicitar el traspaso.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="center-state"><span className="loading-orb" />Cargando traspasos…</main>;
  if (!session) return null;
  if (!session.permissions.includes("transfers.manage")) {
    return (
      <main className="center-state inventory-denied">
        <div>
          <strong>Acceso restringido</strong>
          <p>Tu sesión no tiene permiso para administrar traspasos entre sucursales.</p>
          <Link href="/dashboard">Volver al resumen</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <p className="eyebrow">Traspasos · Sucursales</p>
          <h1>Mueve stock entre sucursales sin perder el rastro.</h1>
          <p className="procurement-lede">Solicita un traspaso eligiendo lote de origen, sigue su aprobación y despacho, y confirma lo recibido.</p>
        </div>
      </header>

      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="procurement-layout">
        <article className="procurement-orders panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Traspasos</p><h2>Historial y seguimiento</h2></div>
            <span className="panel-count">{transfers.length.toString().padStart(2, "0")}</span>
          </div>
          {transfers.length ? (
            <div className="order-list">
              {transfers.map((transfer) => (
                <Link className="order-card" href={`/transfers/${transfer.id}`} key={transfer.id}>
                  <div className="order-card-head">
                    <div>
                      <strong>{warehouseName(transfer.originWarehouseId)} → {warehouseName(transfer.destinationWarehouseId)}</strong>
                      <small>{formatDate(transfer.createdAt)} · {transfer.items.length} {transfer.items.length === 1 ? "ítem" : "ítems"}</small>
                    </div>
                    <span className="order-status">{statusLabels[transfer.status]}</span>
                  </div>
                  <p className="order-id">Traspaso {transfer.id.slice(0, 8)}…</p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="procurement-empty">
              <span className="empty-symbol">✦</span>
              <h3>Aún no hay traspasos.</h3>
              <p>Solicita el primero para mover stock entre tus almacenes.</p>
            </div>
          )}
        </article>

        <div className="procurement-side">
          <aside className="panel procurement-form-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Nuevo traspaso</p><h2>Solicitar movimiento</h2></div>
              <span className="panel-count">{items.length.toString().padStart(2, "0")}</span>
            </div>
            <form className="procurement-form" onSubmit={submitRequest}>
              <label className="field">
                <span>Almacén de origen</span>
                <select required value={originWarehouseId} onChange={(event) => { setOriginWarehouseId(event.target.value); setItems([emptyItem()]); }}>
                  <option value="">Selecciona almacén</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.branchName ? ` · ${warehouse.branchName}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Almacén de destino</span>
                <select required value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)}>
                  <option value="">Selecciona almacén</option>
                  {warehouses.filter((warehouse) => warehouse.id !== originWarehouseId).map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.branchName ? ` · ${warehouse.branchName}` : ""}</option>
                  ))}
                </select>
              </label>

              <div className="order-draft-lines">
                {items.map((item, index) => (
                  <div className="order-draft-line" key={index}>
                    <label className="field">
                      <span>Producto / lote {index + 1}</span>
                      <select required disabled={!originWarehouseId} value={item.stockKey} onChange={(event) => updateItem(index, { stockKey: event.target.value })}>
                        <option value="">{originWarehouseId ? "Selecciona producto y lote" : "Elige antes el almacén de origen"}</option>
                        {stockOptions.map((option) => (
                          <option key={stockKey(option)} value={stockKey(option)}>
                            {option.productName} · {option.presentationName}{option.lotCode ? ` · Lote ${option.lotCode}` : ""} (disp. {option.availableQty})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field"><span>Cantidad</span><input min="1" required type="number" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} /></label>
                    {items.length > 1 ? <button className="row-action row-action-danger" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">Quitar ítem</button> : null}
                  </div>
                ))}
              </div>
              <button className="secondary-button" disabled={!originWarehouseId} onClick={() => setItems((current) => [...current, emptyItem()])} type="button">+ Agregar ítem</button>
              <button className="primary-button" disabled={saving || !warehouses.length} type="submit">{saving ? "Solicitando…" : "Solicitar traspaso"}<span>↗</span></button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
