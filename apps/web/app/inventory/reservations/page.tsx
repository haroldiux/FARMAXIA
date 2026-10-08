"use client";

import { useEffect, useState } from "react";
import { InventoryNav } from "../../components/inventory-nav";
import { listReservations, releaseReservation, type ReservationStatus, type ReservationSummary } from "../../lib/inventory";

const statusLabels: Record<ReservationStatus, string> = {
  ACTIVE: "Activa",
  CONSUMED: "Consumida",
  RELEASED: "Liberada",
  EXPIRED: "Vencida"
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ReservationsPage() {
  const [status, setStatus] = useState<ReservationStatus | "">("ACTIVE");
  const [reservations, setReservations] = useState<ReservationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setReservations(null);
    listReservations(status || undefined)
      .then((result) => setReservations(result.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar las reservas."));
  }, [status, version]);

  async function release(reservation: ReservationSummary): Promise<void> {
    if (!window.confirm(`¿Liberar ${reservation.quantityBase} unidades del lote ${reservation.lotCode}? Volverán al stock libre.`)) return;
    setError(null);
    setNotice(null);
    try {
      await releaseReservation(reservation.id);
      setNotice("Reserva liberada: las unidades volvieron al stock libre.");
      setVersion((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos liberar la reserva.");
    }
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <p className="eyebrow">Inventario · Reservas</p>
          <h1>Stock apartado para ventas.</h1>
          <p className="inventory-lede">Las ventas apartan unidades por lote (FEFO) mientras se confirman. Una reserva activa descuenta del stock libre y vence sola si no se usa. La venta POS actual descuenta directo; usar reservas en pedidos está pendiente (D09).</p>
        </div>
      </header>
      <InventoryNav />
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success inventory-message" role="status">{notice}</p> : null}

      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Sucursal activa</p><h2>Reservas</h2></div>
          <label className="inventory-filter"><span>Estado</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as ReservationStatus | "")}>
              <option value="">Todas</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {reservations === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : reservations.length ? (
          <div className="category-list">
            {reservations.map((reservation) => (
              <div className="category-row" key={reservation.id}>
                <div>
                  <strong>{reservation.productName} · {reservation.presentationName}</strong>
                  <small>
                    Lote {reservation.lotCode} · {reservation.quantityBase} {reservation.quantityBase === 1 ? "unidad" : "unidades"} · {reservation.warehouseName} · creada {formatDateTime(reservation.createdAt)}
                    {reservation.status === "ACTIVE" ? ` · vence ${formatDateTime(reservation.reservedUntil)}` : ""}
                  </small>
                </div>
                <div className="user-actions">
                  <span className={`order-status reservation-${reservation.status.toLowerCase()}`}>{statusLabels[reservation.status]}</span>
                  {reservation.status === "ACTIVE" ? <button className="row-action" onClick={() => void release(reservation)} type="button">Liberar</button> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="catalog-empty"><span>✓</span><h3>No hay reservas con este estado.</h3><p>Las reservas aparecen cuando una venta aparta stock.</p></div>}
      </section>
    </main>
  );
}
