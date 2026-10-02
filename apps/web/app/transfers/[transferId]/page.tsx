"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, type AuthSession } from "../../lib/session";
import {
  approveTransfer,
  dispatchTransfer,
  getTransfer,
  lookupWarehouses,
  receiveTransfer,
  rejectTransfer,
  type ReceiveTransferItemInput,
  type Transfer,
  type TransferStatus,
  type TransferWarehouseOption
} from "../../lib/transfers";

const statusLabels: Record<TransferStatus, string> = {
  REQUESTED: "Solicitado",
  APPROVED: "Aprobado",
  DISPATCHED: "Despachado",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibido",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado"
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-BO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface ReceiveDraft {
  itemId: string;
  quantity: string;
  reason: string;
}

export default function TransferDetailPage() {
  const params = useParams<{ transferId: string }>();
  const transferId = params?.transferId;

  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<TransferWarehouseOption[]>([]);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [receiveDraft, setReceiveDraft] = useState<Record<string, ReceiveDraft>>({});

  async function refresh(): Promise<void> {
    if (!transferId) return;
    const [transferResult, warehouseResult] = await Promise.all([getTransfer(transferId), lookupWarehouses()]);
    setTransfer(transferResult);
    setWarehouses(warehouseResult.items);
    const draft: Record<string, ReceiveDraft> = {};
    for (const item of transferResult.items) {
      const pending = (item.dispatchedQty ?? 0) - item.receivedQty;
      draft[item.id] = { itemId: item.id, quantity: pending > 0 ? String(pending) : "0", reason: "" };
    }
    setReceiveDraft(draft);
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
      if (!value.permissions.includes("transfers.manage") && !value.permissions.includes("transfers.approve")) {
        setLoading(false);
        return;
      }
      try {
        await refresh();
      } catch (reasonValue) {
        if (mounted) setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar el traspaso.");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferId]);

  function warehouseName(id: string): string {
    const match = warehouses.find((warehouse) => warehouse.id === id);
    if (!match) return "Almacén";
    return match.branchName ? `${match.name} · ${match.branchName}` : match.name;
  }

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(success);
    } catch (reasonValue) {
      // El backend ya devuelve mensajes claros en español (por ejemplo, si falta aprobar antes de
      // despachar en plan Premium); se muestran tal cual en vez de ocultarlos.
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos completar la operación.");
    } finally {
      setSaving(false);
    }
  }

  async function submitReject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!transfer) return;
    await run(() => rejectTransfer(transfer.id, rejectReason.trim()), "Traspaso rechazado.");
    setRejecting(false);
    setRejectReason("");
  }

  async function submitReceive(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!transfer) return;
    const payload: ReceiveTransferItemInput[] = [];
    for (const item of transfer.items) {
      const draft = receiveDraft[item.id];
      const quantity = Number(draft?.quantity ?? 0);
      if (!quantity) continue;
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        setError("La cantidad recibida de cada ítem debe ser un entero positivo.");
        return;
      }
      payload.push({ itemId: item.id, receivedQty: quantity, differenceReason: draft?.reason.trim() || undefined });
    }
    if (!payload.length) {
      setError("Indica la cantidad recibida de al menos un ítem.");
      return;
    }
    await run(() => receiveTransfer(transfer.id, payload), "Recepción registrada.");
  }

  if (loading) return <main className="center-state"><span className="loading-orb" />Cargando traspaso…</main>;
  if (!session) return null;
  if (!session.permissions.includes("transfers.manage") && !session.permissions.includes("transfers.approve")) {
    return (
      <main className="center-state inventory-denied">
        <div>
          <strong>Acceso restringido</strong>
          <p>Tu sesión no tiene permiso para ver traspasos entre sucursales.</p>
          <Link href="/dashboard">Volver al resumen</Link>
        </div>
      </main>
    );
  }
  if (!transfer) {
    return (
      <main className="center-state">
        <div>
          <strong>Traspaso no encontrado</strong>
          <p><Link href="/transfers">Volver a traspasos</Link></p>
        </div>
      </main>
    );
  }

  const canApprove = transfer.status === "REQUESTED" && session.permissions.includes("transfers.approve");
  // El plan Profesional no exige aprobación: el propio dispatch ya rechaza con un mensaje claro
  // ("plan Premium") si hiciera falta aprobar primero. En vez de ocultar el botón en ese caso (lo
  // que exigiría exponer el feature flag `transfers.approval` al frontend, algo que la sesión no
  // expone hoy), se muestra siempre que el estado lo permite y se deja que el error, si llega, se
  // vea tal cual.
  const canDispatch = (transfer.status === "REQUESTED" || transfer.status === "APPROVED") && session.permissions.includes("transfers.manage");
  const canReceive = (transfer.status === "DISPATCHED" || transfer.status === "PARTIALLY_RECEIVED") && session.permissions.includes("transfers.manage");
  const readOnly = transfer.status === "RECEIVED" || transfer.status === "REJECTED" || transfer.status === "CANCELLED";

  return (
    <main className="procurement-page">
      <header className="procurement-header">
        <div>
          <p className="eyebrow">Traspasos · Detalle</p>
          <h1>{warehouseName(transfer.originWarehouseId)} → {warehouseName(transfer.destinationWarehouseId)}</h1>
          <p className="procurement-lede">Traspaso {transfer.id.slice(0, 8)}… · Solicitado el {formatDateTime(transfer.createdAt)}</p>
        </div>
        <span className="order-status">{statusLabels[transfer.status]}</span>
      </header>

      <p><Link href="/transfers">← Volver a traspasos</Link></p>

      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      {transfer.rejectionReason ? <p className="form-note">Motivo de rechazo: {transfer.rejectionReason}</p> : null}

      <section className="procurement-layout">
        <article className="procurement-orders panel">
          <div className="panel-heading"><div><p className="section-kicker">Ítems</p><h2>Cantidades del traspaso</h2></div><span className="panel-count">{transfer.items.length.toString().padStart(2, "0")}</span></div>
          <div className="order-lines">
            {transfer.items.map((item) => (
              <div className="order-line" key={item.id}>
                <span>Presentación {item.presentationId.slice(0, 8)}… · Lote {item.batchId.slice(0, 8)}…</span>
                <strong>{item.receivedQty}/{item.dispatchedQty ?? item.requestedQty} u.</strong>
                <small>Solicitado {item.requestedQty}{item.dispatchedQty !== null ? ` · Despachado ${item.dispatchedQty}` : ""}{item.differenceReason ? ` · Diferencia: ${item.differenceReason}` : ""}</small>
              </div>
            ))}
          </div>
        </article>

        <div className="procurement-side">
          {canApprove ? (
            <aside className="panel procurement-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">Aprobación</p><h2>¿Autorizas este traspaso?</h2></div></div>
              {!rejecting ? (
                <div className="user-actions">
                  <button className="primary-button" disabled={saving} onClick={() => run(() => approveTransfer(transfer.id), "Traspaso aprobado.")} type="button">{saving ? "Aprobando…" : "Aprobar"}</button>
                  <button className="row-action row-action-danger" disabled={saving} onClick={() => setRejecting(true)} type="button">Rechazar</button>
                </div>
              ) : (
                <form className="procurement-form" onSubmit={submitReject}>
                  <label className="field"><span>Motivo de rechazo</span><input autoFocus maxLength={255} minLength={3} required value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Ej. El origen ya no tiene ese stock disponible" /></label>
                  <div className="user-actions">
                    <button className="row-action" onClick={() => { setRejecting(false); setRejectReason(""); }} type="button">Volver</button>
                    <button className="row-action row-action-danger" disabled={saving} type="submit">{saving ? "Rechazando…" : "Confirmar rechazo"}</button>
                  </div>
                </form>
              )}
            </aside>
          ) : null}

          {!canApprove && transfer.status === "APPROVED" && session.permissions.includes("transfers.approve") ? (
            <aside className="panel procurement-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">Aprobación</p><h2>Ya aprobado</h2></div></div>
              <p className="form-note">Puedes rechazarlo todavía si cambia la situación, antes de que se despache.</p>
              {!rejecting ? (
                <button className="row-action row-action-danger" disabled={saving} onClick={() => setRejecting(true)} type="button">Rechazar</button>
              ) : (
                <form className="procurement-form" onSubmit={submitReject}>
                  <label className="field"><span>Motivo de rechazo</span><input autoFocus maxLength={255} minLength={3} required value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label>
                  <div className="user-actions">
                    <button className="row-action" onClick={() => { setRejecting(false); setRejectReason(""); }} type="button">Volver</button>
                    <button className="row-action row-action-danger" disabled={saving} type="submit">{saving ? "Rechazando…" : "Confirmar rechazo"}</button>
                  </div>
                </form>
              )}
            </aside>
          ) : null}

          {canDispatch ? (
            <aside className="panel procurement-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">Despacho</p><h2>Enviar stock</h2></div></div>
              <p className="form-note">Descuenta el stock del almacén de origen al confirmar.</p>
              <button className="primary-button" disabled={saving} onClick={() => run(() => dispatchTransfer(transfer.id), "Traspaso despachado.")} type="button">{saving ? "Despachando…" : "Despachar"}<span>↗</span></button>
            </aside>
          ) : null}

          {canReceive ? (
            <aside className="panel procurement-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">Recepción</p><h2>Confirmar lo recibido</h2></div></div>
              <form className="procurement-form" onSubmit={submitReceive}>
                {transfer.items.map((item) => {
                  const pending = (item.dispatchedQty ?? 0) - item.receivedQty;
                  if (pending <= 0) return null;
                  const draft = receiveDraft[item.id] ?? { itemId: item.id, quantity: "0", reason: "" };
                  return (
                    <div className="order-draft-line" key={item.id}>
                      <p className="form-note">Lote {item.batchId.slice(0, 8)}… · pendiente {pending} de {item.dispatchedQty}</p>
                      <div className="procurement-field-grid">
                        <label className="field"><span>Cantidad recibida</span><input max={pending} min="0" type="number" value={draft.quantity} onChange={(event) => setReceiveDraft((current) => ({ ...current, [item.id]: { ...draft, quantity: event.target.value } }))} /></label>
                        <label className="field"><span>Motivo de diferencia <small>opcional</small></span><input maxLength={255} value={draft.reason} onChange={(event) => setReceiveDraft((current) => ({ ...current, [item.id]: { ...draft, reason: event.target.value } }))} placeholder="Ej. Caja dañada en tránsito" /></label>
                      </div>
                    </div>
                  );
                })}
                <button className="primary-button" disabled={saving} type="submit">{saving ? "Registrando…" : "Registrar recepción"}<span>↗</span></button>
              </form>
            </aside>
          ) : null}

          {readOnly ? (
            <aside className="panel procurement-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">Estado final</p><h2>{statusLabels[transfer.status]}</h2></div></div>
              <p className="form-note">Este traspaso ya no admite más acciones.</p>
            </aside>
          ) : null}
        </div>
      </section>
    </main>
  );
}
