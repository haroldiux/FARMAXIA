"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { InventoryNav } from "../../components/inventory-nav";
import { disposalMethodLabels, listWasteActs, type WasteAct } from "../../lib/inventory";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function WasteActsPage() {
  const [acts, setActs] = useState<WasteAct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWasteActs()
      .then((result) => setActs(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar las actas."));
  }, []);

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="eyebrow">Inventario · Actas de baja</p>
          <h1>Cada merma, con su acta.</h1>
          <p className="inventory-lede">Toda merma registrada genera un acta numerada por sucursal, lista para imprimir y firmar. Las mermas se registran desde Vencimientos.</p>
        </div>
      </header>
      <InventoryNav />
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}

      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">Historial</p><h2>Actas de baja</h2></div><span className="panel-count">{(acts?.length ?? 0).toString().padStart(2, "0")}</span></div>
        {acts === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : acts.length ? (
          <div className="category-list">
            {acts.map((act) => (
              <div className="category-row" key={act.id}>
                <div>
                  <strong>{act.actNumber ?? "Sin número (merma anterior)"} · {act.productName}</strong>
                  <small>
                    {formatDateTime(act.createdAt)} · lote {act.lotCode} · {act.quantityBase} {act.quantityBase === 1 ? "unidad" : "unidades"} · {act.warehouseName}
                    {act.disposalMethod ? ` · ${disposalMethodLabels[act.disposalMethod]}` : ""}
                  </small>
                </div>
                <div className="user-actions">
                  <Link className="row-action" href={`/inventory/waste-acts/${act.id}`}>Ver acta</Link>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="catalog-empty"><span>✓</span><h3>No hay mermas registradas.</h3><p>Cuando registres una merma aparecerá aquí con su acta.</p></div>}
      </section>
    </main>
  );
}
