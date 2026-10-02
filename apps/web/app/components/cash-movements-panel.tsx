"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  cashShiftIdempotencyKey,
  createCashMovement,
  listCashMovements,
  type CashMovementCategory,
  type CashMovementList,
  type CashMovementType,
  type CashShiftControl
} from "../lib/cash";

const categoryLabels: Record<CashMovementCategory, string> = {
  CHANGE_FUND: "Fondo de cambio",
  EXPENSE: "Gasto",
  DEPOSIT: "Depósito",
  OTHER: "Otro"
};

const decimalPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

interface CashMovementsPanelProps {
  shiftId: string;
  control: CashShiftControl;
  /** True when the signed-in user is assigned to the shift and may register movements. */
  canRegister: boolean;
  /** Called after a movement is saved so the parent refreshes the expected cash. */
  onChanged: () => Promise<void>;
}

/** Movimientos de caja (ingresos y egresos) de un turno abierto. */
export function CashMovementsPanel({ shiftId, control, canRegister, onChanged }: CashMovementsPanelProps) {
  const [data, setData] = useState<CashMovementList | null>(null);
  const [type, setType] = useState<CashMovementType>("OUT");
  const [amountBob, setAmountBob] = useState("");
  const [category, setCategory] = useState<CashMovementCategory | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listCashMovements(shiftId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar los movimientos.");
    }
  }, [shiftId]);

  useEffect(() => {
    void load();
  }, [load, control.expectedAmountBob]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const amount = amountBob.trim();
    const cleanReason = reason.trim();
    if (!decimalPattern.test(amount) || !/[1-9]/.test(amount)) {
      setError("El monto debe ser mayor a cero, con hasta 4 decimales.");
      return;
    }
    if (!cleanReason || cleanReason.length > 200) {
      setError("El motivo es obligatorio y admite hasta 200 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await createCashMovement(shiftId, {
        idempotencyKey: cashShiftIdempotencyKey(),
        type,
        amountBob: amount,
        reason: cleanReason,
        category: category || null
      });
      setAmountBob("");
      setReason("");
      setCategory("");
      await Promise.all([load(), onChanged()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No pudimos registrar el movimiento.");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  return (
    <section className="cash-movements" aria-label="Movimientos de caja">
      <div className="cash-control-heading"><strong>Movimientos de caja</strong><span>{data?.items.length ?? 0}</span></div>
      <dl className="cash-breakdown">
        <div><dt>Fondo inicial</dt><dd>{summary?.openingAmountBob ?? control.openingAmountBob} BOB</dd></div>
        <div><dt>Ventas en efectivo</dt><dd>{summary?.cashSalesBob ?? control.cashSalesBob} BOB</dd></div>
        <div><dt>Ingresos</dt><dd>+ {summary?.movementsInBob ?? control.movementsInBob} BOB</dd></div>
        <div><dt>Egresos</dt><dd>− {summary?.movementsOutBob ?? control.movementsOutBob} BOB</dd></div>
        <div className="cash-breakdown-total"><dt>Efectivo esperado</dt><dd>{summary?.expectedAmountBob ?? control.expectedAmountBob} BOB</dd></div>
      </dl>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {canRegister ? <form className="cash-movement-form" onSubmit={submit}>
        <label className="field"><span>Tipo</span><select value={type} onChange={(event) => setType(event.target.value as CashMovementType)}><option value="OUT">Egreso</option><option value="IN">Ingreso</option></select></label>
        <label className="field"><span>Monto (BOB)</span><input type="text" inputMode="decimal" placeholder="0.00" value={amountBob} onChange={(event) => setAmountBob(event.target.value)} /></label>
        <label className="field"><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value as CashMovementCategory | "")}><option value="">Sin categoría</option>{(Object.keys(categoryLabels) as CashMovementCategory[]).map((code) => <option key={code} value={code}>{categoryLabels[code]}</option>)}</select></label>
        <label className="field cash-movement-reason"><span>Motivo</span><input type="text" maxLength={200} placeholder="Ej. compra de bolsas" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="secondary-button" disabled={busy} type="submit">{busy ? "Registrando…" : "Registrar movimiento"}</button>
      </form> : <p className="form-note">Solo una persona asignada puede registrar movimientos.</p>}
      {data?.items.length ? <ul className="cash-movement-list">{[...data.items].reverse().map((item) => <li key={item.id}>
        <span className={item.type === "IN" ? "cash-movement-in" : "cash-movement-out"}>{item.type === "IN" ? "+" : "−"} {item.amountBob} BOB</span>
        <span>{item.reason}{item.category ? ` · ${categoryLabels[item.category]}` : ""}</span>
        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</time>
      </li>)}</ul> : <p className="form-note">Aún no hay movimientos en este turno.</p>}
    </section>
  );
}
