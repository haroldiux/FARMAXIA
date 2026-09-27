"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { InventoryNav } from "../../components/inventory-nav";
import {
  createWarehouse,
  listWarehouseDetails,
  updateWarehouse,
  warehouseTypeLabels,
  type WarehouseDetail,
  type WarehouseType
} from "../../lib/inventory";

const typeHints: Record<WarehouseType, string> = {
  GENERAL: "Almacén de uso general de la sucursal.",
  CENTRAL: "Almacén principal desde donde se despacha a ventas.",
  QUARANTINE: "Resguardo de lotes observados. Nunca despacha ventas.",
  COLD: "Refrigerados entre 2 °C y 8 °C (cadena de frío)."
};

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseDetail[] | null>(null);
  const [name, setName] = useState("");
  const [warehouseType, setWarehouseType] = useState<WarehouseType>("GENERAL");
  const [isDispatchEnabled, setIsDispatchEnabled] = useState(true);
  const [editing, setEditing] = useState<{ id: string; name: string; warehouseType: WarehouseType } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setWarehouses((await listWarehouseDetails(true)).items), []);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar los almacenes."));
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar el almacén.");
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const created = name.trim();
    void run(async () => {
      await createWarehouse({ name: created, warehouseType, isDispatchEnabled: warehouseType === "QUARANTINE" ? false : isDispatchEnabled });
      setName("");
      setWarehouseType("GENERAL");
      setIsDispatchEnabled(true);
    }, `Almacén ${created} creado.`);
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">Inventario · Almacenes</p>
          <h1>Almacenes de la sucursal.</h1>
          <p className="inventory-lede">Separa el stock en almacén central, cuarentena y cadena de frío. Solo los almacenes con despacho activo abastecen las ventas.</p>
        </div>
      </header>
      <InventoryNav />
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success inventory-message" role="status">{notice}</p> : null}

      <section className="catalog-layout">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Configuración</p><h2>Almacenes</h2></div><span className="panel-count">{(warehouses?.length ?? 0).toString().padStart(2, "0")}</span></div>
          {warehouses === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : warehouses.length ? (
            <div className="category-list">
              {warehouses.map((warehouse) => (
                <div className={`category-row ${warehouse.isActive ? "" : "is-inactive"}`} key={warehouse.id}>
                  {editing?.id === warehouse.id ? (
                    <form className="inline-rename" onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await updateWarehouse(warehouse.id, { name: editing.name, warehouseType: editing.warehouseType });
                        setEditing(null);
                      }, "Almacén actualizado.");
                    }}>
                      <input aria-label="Nombre del almacén" maxLength={160} required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                      <select aria-label="Tipo de almacén" value={editing.warehouseType} onChange={(event) => setEditing({ ...editing, warehouseType: event.target.value as WarehouseType })}>
                        {Object.entries(warehouseTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <button className="row-action" disabled={busy} type="submit">Guardar</button>
                      <button className="row-action" onClick={() => setEditing(null)} type="button">Cancelar</button>
                    </form>
                  ) : (
                    <div>
                      <strong>{warehouse.name} <span className={`warehouse-type type-${warehouse.warehouseType.toLowerCase()}`}>{warehouseTypeLabels[warehouse.warehouseType]}</span></strong>
                      <small>
                        {warehouse.batchCount} {warehouse.batchCount === 1 ? "lote" : "lotes"} · {warehouse.stockBase} unidades
                        {warehouse.reservedBase ? ` (${warehouse.reservedBase} reservadas)` : ""}
                        {" · "}{warehouse.isDispatchEnabled ? "despacha a ventas" : "solo resguardo"}
                        {warehouse.isActive ? "" : " · desactivado"}
                      </small>
                    </div>
                  )}
                  <div className="user-actions">
                    <button className="row-action" disabled={busy} onClick={() => setEditing({ id: warehouse.id, name: warehouse.name, warehouseType: warehouse.warehouseType })} type="button">Editar</button>
                    {warehouse.warehouseType !== "QUARANTINE" && warehouse.isActive ? (
                      <button className="row-action" disabled={busy} onClick={() => void run(() => updateWarehouse(warehouse.id, { isDispatchEnabled: !warehouse.isDispatchEnabled }), warehouse.isDispatchEnabled ? "El almacén ya no despacha a ventas." : "El almacén ahora despacha a ventas.")} type="button">
                        {warehouse.isDispatchEnabled ? "Quitar despacho" : "Activar despacho"}
                      </button>
                    ) : null}
                    <button className={`row-action ${warehouse.isActive ? "row-action-danger" : ""}`} disabled={busy} onClick={() => {
                      if (warehouse.isActive && !window.confirm(`¿Desactivar ${warehouse.name}? Debe estar sin stock ni reservas.`)) return;
                      void run(() => updateWarehouse(warehouse.id, { isActive: !warehouse.isActive }), warehouse.isActive ? "Almacén desactivado." : "Almacén reactivado.");
                    }} type="button">
                      {warehouse.isActive ? "Desactivar" : "Reactivar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="catalog-empty"><span>✦</span><h3>Aún no hay almacenes.</h3><p>Crea el primero desde el panel lateral.</p></div>}
        </article>

        <aside className="create-product-panel">
          <div className="panel-heading"><div><p className="section-kicker">Alta</p><h2>Nuevo almacén</h2></div></div>
          <form className="product-form" onSubmit={create}>
            <label className="field"><span>Nombre</span><input maxLength={160} minLength={2} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Refrigerador 1" /></label>
            <label className="field"><span>Tipo</span>
              <select value={warehouseType} onChange={(event) => setWarehouseType(event.target.value as WarehouseType)}>
                {Object.entries(warehouseTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <p className="field-hint">{typeHints[warehouseType]}</p>
            {warehouseType !== "QUARANTINE" ? (
              <label className="field"><span><input checked={isDispatchEnabled} onChange={(event) => setIsDispatchEnabled(event.target.checked)} type="checkbox" /> Despacha a ventas (FEFO)</span></label>
            ) : null}
            <button className="primary-button" disabled={busy} type="submit">{busy ? "Guardando…" : "Crear almacén"}<span aria-hidden="true">↗</span></button>
          </form>
        </aside>
      </section>
    </main>
  );
}
