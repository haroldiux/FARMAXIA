"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { InventoryNav } from "../../components/inventory-nav";
import { countStatusLabels, createCount, listCounts, listWarehouses, type CountSummary, type Warehouse } from "../../lib/inventory";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CountsPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<CountSummary[] | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listCounts(), listWarehouses()])
      .then(([countList, warehouseList]) => {
        setCounts(countList.items);
        setWarehouses(warehouseList.items);
        setWarehouseId(warehouseList.items[0]?.id ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar los conteos."));
  }, []);

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createCount({ warehouseId, notes: notes.trim() || undefined });
      router.push(`/inventory/counts/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos abrir el conteo.");
      setBusy(false);
    }
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="eyebrow">Inventario · Inventario físico</p>
          <h1>Conteo ciego, ajuste aprobado.</h1>
          <p className="inventory-lede">Quien cuenta no ve el stock del sistema. Al enviar el conteo aparecen las diferencias y un responsable las aprueba para ajustar el inventario.</p>
        </div>
      </header>
      <InventoryNav />
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}

      <section className="catalog-layout">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Historial</p><h2>Conteos de la sucursal</h2></div><span className="panel-count">{(counts?.length ?? 0).toString().padStart(2, "0")}</span></div>
          {counts === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : counts.length ? (
            <div className="category-list">
              {counts.map((count) => (
                <Link className="category-row count-row" href={`/inventory/counts/${count.id}`} key={count.id}>
                  <div>
                    <strong>{count.number} · {count.warehouseName}</strong>
                    <small>
                      {formatDateTime(count.createdAt)}{count.createdByName ? ` · ${count.createdByName}` : ""} · {count.countedLines}/{count.lineCount} lotes contados
                      {count.differenceLines !== null ? ` · ${count.differenceLines} con diferencia` : ""}
                    </small>
                  </div>
                  <span className={`order-status count-${count.status.toLowerCase()}`}>{countStatusLabels[count.status]}</span>
                </Link>
              ))}
            </div>
          ) : <div className="catalog-empty"><span>✦</span><h3>Todavía no hay conteos.</h3><p>Abre el primero desde el panel lateral.</p></div>}
        </article>

        <aside className="create-product-panel">
          <div className="panel-heading"><div><p className="section-kicker">Nuevo</p><h2>Abrir conteo</h2></div></div>
          <form className="product-form" onSubmit={start}>
            <label className="field"><span>Almacén</span>
              <select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Nota (opcional)</span><input maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. Cierre de septiembre" /></label>
            <p className="field-hint">Se incluyen todos los lotes con existencias del almacén. Solo puede haber un conteo en curso por almacén.</p>
            <button className="primary-button" disabled={busy || !warehouseId} type="submit">{busy ? "Abriendo…" : "Abrir conteo"}<span aria-hidden="true">↗</span></button>
          </form>
        </aside>
      </section>
    </main>
  );
}
