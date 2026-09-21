"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  cashShiftIdempotencyKey,
  approveCashShift,
  countCashShift,
  createCashShift,
  listCashRegisters,
  listCashShifts,
  listEligibleCashUsers,
  openCashShift,
  type CashRegister,
  type CashShift,
  type EligibleCashUser
} from "../lib/cash";
import { currentSession, logout, type AuthSession } from "../lib/session";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("es-BO", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export default function CashPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [users, setUsers] = useState<EligibleCashUser[]>([]);
  const [shifts, setShifts] = useState<CashShift[]>([]);
  const [cashRegisterId, setCashRegisterId] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [scheduledEndAt, setScheduledEndAt] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openingDrafts, setOpeningDrafts] = useState<Record<string, string>>({});
  const [countingDrafts, setCountingDrafts] = useState<Record<string, string>>({});
  const [controlBusy, setControlBusy] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [registerResult, userResult, shiftResult] = await Promise.all([
      listCashRegisters(),
      listEligibleCashUsers(),
      listCashShifts()
    ]);
    setRegisters(registerResult.items);
    setUsers(userResult.items);
    setShifts(shiftResult.items);
    setCashRegisterId((value) => value || registerResult.items[0]?.id || "");
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      try {
        const value = await currentSession();
        if (!mounted) return;
        setSession(value);
        if (value.permissions.includes("cash.manage")) {
          await refresh();
        }
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "No pudimos cargar caja.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  function toggleUser(userId: string): void {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((candidate) => candidate !== userId)
        : [...current, userId]
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!cashRegisterId || !scheduledStartAt || !scheduledEndAt || !selectedUserIds.length) {
      setError("Selecciona caja, inicio, fin y al menos una persona.");
      return;
    }
    const start = new Date(scheduledStartAt);
    const end = new Date(scheduledEndAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError("El fin del turno debe ser posterior al inicio.");
      return;
    }
    setSaving(true);
    try {
      await createCashShift({
        idempotencyKey: cashShiftIdempotencyKey(),
        cashRegisterId,
        scheduledStartAt: start.toISOString(),
        scheduledEndAt: end.toISOString(),
        userIds: selectedUserIds
      });
      await refresh();
      setScheduledStartAt("");
      setScheduledEndAt("");
      setSelectedUserIds([]);
      setNotice("Turno programado sin superponer el horario de la caja.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos programar el turno.");
    } finally {
      setSaving(false);
    }
  }

  function decimal(value: string): boolean {
    return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(value.trim());
  }

  async function handleOpen(shift: CashShift): Promise<void> {
    const openingAmountBob = openingDrafts[shift.id]?.trim() ?? "";
    if (!decimal(openingAmountBob)) {
      setError("El monto inicial debe ser un decimal no negativo con hasta 4 decimales.");
      return;
    }
    setError(null);
    setNotice(null);
    setControlBusy(`${shift.id}:open`);
    try {
      await openCashShift(shift.id, { idempotencyKey: cashShiftIdempotencyKey(), openingAmountBob });
      await refresh();
      setOpeningDrafts((current) => ({ ...current, [shift.id]: "" }));
      setNotice("Turno abierto. El monto inicial será la base esperada del conteo.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos abrir el turno.");
    } finally {
      setControlBusy(null);
    }
  }

  async function handleCount(shift: CashShift): Promise<void> {
    const countedAmountBob = countingDrafts[shift.id]?.trim() ?? "";
    if (!decimal(countedAmountBob)) {
      setError("El conteo debe ser un decimal no negativo con hasta 4 decimales.");
      return;
    }
    setError(null);
    setNotice(null);
    setControlBusy(`${shift.id}:count`);
    try {
      await countCashShift(shift.id, { idempotencyKey: cashShiftIdempotencyKey(), countedAmountBob });
      await refresh();
      setCountingDrafts((current) => ({ ...current, [shift.id]: "" }));
      setNotice("Conteo guardado. Las diferencias distintas de cero requieren aprobación.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar el conteo.");
    } finally {
      setControlBusy(null);
    }
  }

  async function handleApprove(shift: CashShift): Promise<void> {
    setError(null);
    setNotice(null);
    setControlBusy(`${shift.id}:approve`);
    try {
      await approveCashShift(shift.id, {
        idempotencyKey: cashShiftIdempotencyKey(),
        approvalNote: "Diferencia revisada por supervisor"
      });
      await refresh();
      setNotice("Diferencia aprobada y turno cerrado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos aprobar la diferencia.");
    } finally {
      setControlBusy(null);
    }
  }

  async function signOut(): Promise<void> {
    await logout();
    window.location.assign("/");
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando turnos de caja…</main>;
  }
  if (!session) {
    return <main className="center-state"><div><strong>No pudimos validar tu sesión.</strong><p>{error}</p><Link href="/">Volver al ingreso</Link></div></main>;
  }
  if (!session.permissions.includes("cash.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar turnos de caja.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">F6 · Ventas y caja</p>
          <h1>Una caja, el turno correcto.</h1>
          <p className="cash-lede">Programa horarios fechados y asigna a una o más personas sin superponer la misma caja.</p>
        </div>
        <button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button>
      </header>

      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success cash-message" role="status">{notice}</p> : null}

      <section className="cash-layout">
        <article className="panel cash-shifts-panel">
          <div className="panel-heading"><div><p className="section-kicker">Agenda operativa</p><h2>Turnos programados</h2></div><span className="panel-count">{shifts.length.toString().padStart(2, "0")}</span></div>
          {shifts.length ? <div className="cash-shift-list">{shifts.map((shift) => <article className="cash-shift-card" key={shift.id}>
            <div className="cash-shift-card-head"><strong>{shift.cashRegisterCode}</strong><span>{shift.status === "SCHEDULED" ? "Programado" : "Cancelado"}</span></div>
            <p>{formatTimestamp(shift.scheduledStartAt)} → {formatTimestamp(shift.scheduledEndAt)}</p>
            <div className="cash-assignees">{shift.users.map((user) => <span key={user.id}>{user.displayName}</span>)}</div>
            <div className="cash-control" aria-live="polite">
              {!shift.control ? <>
                <div className="cash-control-heading"><strong>Control de caja</strong><span>Sin abrir</span></div>
                {shift.users.some((user) => user.id === session.userId) ? <div className="cash-control-action">
                  <label className="field"><span>Monto inicial (BOB)</span><input type="text" inputMode="decimal" placeholder="0.0000" value={openingDrafts[shift.id] ?? ""} onChange={(event) => setOpeningDrafts((current) => ({ ...current, [shift.id]: event.target.value }))} /></label>
                  <button className="secondary-button" disabled={controlBusy === `${shift.id}:open`} onClick={() => void handleOpen(shift)} type="button">{controlBusy === `${shift.id}:open` ? "Abriendo…" : "Abrir turno"}</button>
                </div> : <p className="form-note">Solo una persona asignada puede abrir este turno.</p>}
              </> : <>
                <div className="cash-control-heading"><strong>Control de caja</strong><span className={`cash-control-status cash-control-status-${shift.control.status.toLowerCase()}`}>{shift.control.status === "OPEN" ? "Abierto" : shift.control.status === "PENDING_APPROVAL" ? "Pendiente de aprobación" : "Cerrado"}</span></div>
                <p className="cash-control-values">Esperado: <strong>{shift.control.expectedAmountBob} BOB</strong>{shift.control.differenceAmountBob !== null ? <> · Diferencia: <strong>{shift.control.differenceAmountBob} BOB</strong></> : null}</p>
                {shift.control.status === "OPEN" && shift.users.some((user) => user.id === session.userId) ? <div className="cash-control-action">
                  <label className="field"><span>Conteo final (BOB)</span><input type="text" inputMode="decimal" placeholder="0.0000" value={countingDrafts[shift.id] ?? ""} onChange={(event) => setCountingDrafts((current) => ({ ...current, [shift.id]: event.target.value }))} /></label>
                  <button className="secondary-button" disabled={controlBusy === `${shift.id}:count`} onClick={() => void handleCount(shift)} type="button">{controlBusy === `${shift.id}:count` ? "Guardando…" : "Guardar conteo"}</button>
                </div> : null}
                {shift.control.status === "PENDING_APPROVAL" && session.permissions.includes("cash.shift.approve") ? <div className="cash-control-action"><p className="form-note">La diferencia requiere una revisión supervisora.</p><button className="secondary-button" disabled={controlBusy === `${shift.id}:approve`} onClick={() => void handleApprove(shift)} type="button">{controlBusy === `${shift.id}:approve` ? "Aprobando…" : "Aprobar y cerrar"}</button></div> : null}
              </>}
            </div>
          </article>)}</div> : <div className="procurement-empty"><span className="empty-symbol">◇</span><h3>Aún no hay turnos.</h3><p>Programa el primero cuando tengas una caja activa y personal asignable.</p></div>}
        </article>

        <aside className="panel cash-form-panel">
          <div className="panel-heading"><div><p className="section-kicker">Configuración</p><h2>Nuevo turno</h2></div><span className="sparkle">✦</span></div>
          <form className="cash-form" onSubmit={submit}>
            <label className="field"><span>Caja</span><select required value={cashRegisterId} onChange={(event) => setCashRegisterId(event.target.value)}><option value="">Selecciona una caja</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.code}</option>)}</select></label>
            <div className="cash-time-grid">
              <label className="field"><span>Inicio</span><input required type="datetime-local" value={scheduledStartAt} onChange={(event) => setScheduledStartAt(event.target.value)} /></label>
              <label className="field"><span>Fin</span><input required type="datetime-local" value={scheduledEndAt} onChange={(event) => setScheduledEndAt(event.target.value)} /></label>
            </div>
            <fieldset className="cash-user-fieldset"><legend>Personas asignadas</legend>{users.length ? <div className="cash-user-list">{users.map((user) => <label key={user.id}><input checked={selectedUserIds.includes(user.id)} onChange={() => toggleUser(user.id)} type="checkbox" /><span>{user.displayName}</span></label>)}</div> : <p>No hay usuarios activos en esta sucursal.</p>}</fieldset>
            <button className="primary-button" disabled={saving || !registers.length || !users.length} type="submit">{saving ? "Programando…" : "Programar turno"}<span>↗</span></button>
            <p className="form-note">Los horarios son fechas absolutas. Dos turnos de la misma caja pueden ser adyacentes, pero nunca superponerse.</p>
          </form>
        </aside>
      </section>
    </main>
  );
}
