"use client";

import { FormEvent, useState } from "react";
import {
  registerSaleReturn,
  salePaymentMethodLabels,
  voidSale,
  type SaleDetail,
  type SalePaymentMethod
} from "../lib/sales";

interface SaleActionsProps {
  sale: SaleDetail;
  /** Reloads the sale after a void or return. */
  onChanged: () => Promise<void>;
}

type Panel = "none" | "void" | "return";

function money(value: string): string {
  return Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Acciones de supervisión sobre una venta: anulación total y devolución parcial (permiso sales.void). */
export function SaleActions({ sale, onChanged }: SaleActionsProps) {
  const [panel, setPanel] = useState<Panel>("none");
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState<SalePaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canVoid = sale.status === "CONFIRMED";
  const canReturn = sale.status === "CONFIRMED" || sale.status === "PARTIALLY_RETURNED";
  if (!canVoid && !canReturn) return null;

  function open(next: Panel): void {
    setPanel(panel === next ? "none" : next);
    setError(null);
    setNotice(null);
  }

  async function submitVoid(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length > 200) {
      setError("El motivo es obligatorio y admite hasta 200 caracteres.");
      return;
    }
    if (!window.confirm(`¿Anular la venta ${sale.number}? El stock y el efectivo se revertirán y no se puede deshacer.`)) return;
    setBusy(true);
    setError(null);
    try {
      await voidSale(sale.id, cleanReason);
      setPanel("none");
      setReason("");
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No pudimos anular la venta.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const lines: Array<{ saleItemId: string; quantity: number }> = [];
    for (const item of sale.items) {
      const raw = (quantities[item.id] ?? "").trim();
      if (!raw) continue;
      const quantity = Number(raw);
      const remaining = item.quantity - item.returnedQuantity;
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > remaining) {
        setError(`La cantidad de «${item.productName}» debe ser un entero entre 1 y ${remaining}.`);
        return;
      }
      lines.push({ saleItemId: item.id, quantity });
    }
    if (lines.length === 0) {
      setError("Indica la cantidad a devolver de al menos una línea.");
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length > 200) {
      setError("El motivo es obligatorio y admite hasta 200 caracteres.");
      return;
    }
    const cleanReference = reference.trim();
    if (refundMethod !== "CASH" && !cleanReference) {
      setError("Tarjeta y QR requieren una referencia del reembolso.");
      return;
    }
    setBusy(true);
    try {
      const done = await registerSaleReturn(sale.id, {
        reason: cleanReason,
        refundMethod,
        refundReference: refundMethod === "CASH" ? undefined : cleanReference,
        restock,
        lines
      });
      setNotice(`Devolución ${done.returnNumber} registrada. Reembolso: Bs ${money(done.refundAmountBob)}.`);
      setPanel("none");
      setReason("");
      setQuantities({});
      setReference("");
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No pudimos registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel sale-actions no-print" aria-label="Anulación y devoluciones">
      <div>
        <p className="section-kicker">Supervisión</p>
        <h2>Anular o devolver</h2>
      </div>
      <div className="sale-actions-bar">
        {canVoid ? <button className="row-action row-action-danger" onClick={() => open("void")} type="button">Anular venta</button> : null}
        {canReturn ? <button className="secondary-button" onClick={() => open("return")} type="button">Registrar devolución</button> : null}
      </div>
      {notice ? <p className="form-note" role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {panel === "void" ? (
        <form className="sale-action-form" onSubmit={submitVoid}>
          <p className="field-hint sale-action-wide">Solo se puede anular mientras el turno de caja de la venta siga abierto. Todo el stock vuelve a sus lotes originales y el efectivo cobrado sale de la caja.</p>
          <label className="field sale-action-wide"><span>Motivo de la anulación</span><input maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ej. error al registrar el producto" required value={reason} /></label>
          <button className="row-action row-action-danger" disabled={busy} type="submit">{busy ? "Anulando…" : "Confirmar anulación"}</button>
        </form>
      ) : null}

      {panel === "return" ? (
        <form className="sale-action-form" onSubmit={submitReturn}>
          <div className="sale-action-wide">
            {sale.items.map((item) => {
              const remaining = item.quantity - item.returnedQuantity;
              return (
                <label className="sale-return-line" key={item.id}>
                  <span>{item.productName} · {item.presentationName} — vendidas {item.quantity}, devolubles {remaining} a Bs {money(item.unitPriceBob)}</span>
                  <input disabled={remaining <= 0} inputMode="numeric" min={0} max={remaining} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="0" type="number" value={quantities[item.id] ?? ""} />
                </label>
              );
            })}
          </div>
          <label className="field"><span>Método de reembolso</span>
            <select onChange={(event) => setRefundMethod(event.target.value as SalePaymentMethod)} value={refundMethod}>
              {(Object.keys(salePaymentMethodLabels) as SalePaymentMethod[]).map((method) => <option key={method} value={method}>{salePaymentMethodLabels[method]}</option>)}
            </select>
          </label>
          {refundMethod !== "CASH" ? <label className="field"><span>Referencia</span><input maxLength={64} onChange={(event) => setReference(event.target.value)} value={reference} /></label> : null}
          <label className="field sale-action-wide"><span>Motivo de la devolución</span><input maxLength={200} onChange={(event) => setReason(event.target.value)} required value={reason} /></label>
          <label className="sale-action-wide"><input checked={restock} onChange={(event) => setRestock(event.target.checked)} type="checkbox" /> Devolver las unidades al stock (desmarca si están dañadas o no son vendibles)</label>
          {refundMethod === "CASH" ? <p className="field-hint sale-action-wide">El reembolso en efectivo sale de tu turno abierto y no puede superar el efectivo esperado.</p> : null}
          <button className="secondary-button" disabled={busy} type="submit">{busy ? "Registrando…" : "Registrar devolución"}</button>
        </form>
      ) : null}
    </section>
  );
}
