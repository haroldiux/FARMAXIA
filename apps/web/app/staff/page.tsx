"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StaffNav } from "../components/staff-nav";
import { StaffHeader, StaffPlanRequired, useStaffAccess } from "../components/staff-shared";
import {
  addDays,
  bolivianDay,
  boliviaInputToIso,
  cancelShift,
  checkInShift,
  checkOutShift,
  createShift,
  errorMessage,
  formatDayLabel,
  formatShiftDateTime,
  formatTime,
  isPlanRestricted,
  listMyShifts,
  listShifts,
  listStaffMembers,
  shiftKindLabels,
  todayIso,
  weekDays,
  weekStart,
  type ShiftKind,
  type StaffMember,
  type StaffShift
} from "../lib/staff";

function ShiftStatusBadge({ shift }: Readonly<{ shift: StaffShift }>) {
  if (shift.status === "CANCELED") return <span className="order-status sale-voided">Cancelado</span>;
  if (shift.checkedOutAt) return <span className="order-status quote-converted">Completado</span>;
  if (shift.checkedInAt) return <span className="order-status sale-confirmed">En curso</span>;
  return <span className="order-status quote-expired">Programado</span>;
}

/** Turnos propios de hoy en adelante, con registro de entrada y salida. */
function MyShifts({ onRestricted }: Readonly<{ onRestricted: () => void }>) {
  const [shifts, setShifts] = useState<StaffShift[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const today = todayIso();
      setShifts(await listMyShifts({ from: addDays(today, -1), to: addDays(today, 30) }));
    } catch (reason) {
      if (isPlanRestricted(reason)) onRestricted();
      else setError(errorMessage(reason, "No pudimos cargar tus turnos."));
    }
  }, [onRestricted]);

  useEffect(() => {
    void load();
  }, [load]);

  async function attendance(shift: StaffShift, action: "in" | "out") {
    setBusyId(shift.id);
    setError(null);
    setMessage(null);
    try {
      await (action === "in" ? checkInShift(shift.id) : checkOutShift(shift.id));
      setMessage(action === "in" ? "Entrada registrada." : "Salida registrada.");
      await load();
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos registrar la asistencia."));
    } finally {
      setBusyId(null);
    }
  }

  const visible = (shifts ?? []).filter((shift) => shift.status === "SCHEDULED" || bolivianDay(shift.startsAt) >= todayIso());

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">Hoy y próximos días</p><h2>Mis turnos</h2></div>
        <span className="panel-count">{visible.length.toString().padStart(2, "0")}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {message ? <p className="form-success procurement-message" role="status">{message}</p> : null}
      {!shifts && !error ? <p className="pos-hint">Cargando…</p> : null}
      {shifts && !visible.length ? (
        <div className="procurement-empty">
          <span className="empty-symbol">✦</span>
          <h3>No tienes turnos programados.</h3>
          <p>Cuando te asignen un turno aparecerá aquí para que registres tu entrada y salida.</p>
        </div>
      ) : null}
      {visible.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table">
            <thead><tr><th>Turno</th><th>Horario</th><th>Asistencia</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {visible.map((shift) => (
                <tr key={shift.id}>
                  <td>
                    {shiftKindLabels[shift.kind]}
                    {shift.notes ? <small className="controlled-sub">{shift.notes}</small> : null}
                  </td>
                  <td>{formatShiftDateTime(shift.startsAt)} – {formatTime(shift.endsAt)}</td>
                  <td>
                    {shift.checkedInAt ? `Entrada ${formatTime(shift.checkedInAt)}` : "Sin entrada"}
                    {shift.checkedOutAt ? <small className="controlled-sub">Salida {formatTime(shift.checkedOutAt)}</small> : null}
                  </td>
                  <td>
                    <ShiftStatusBadge shift={shift} />
                    {shift.status === "CANCELED" && shift.cancelReason ? <small className="controlled-sub">{shift.cancelReason}</small> : null}
                  </td>
                  <td>
                    {shift.status === "SCHEDULED" && !shift.checkedInAt ? (
                      <button className="row-action" disabled={busyId === shift.id} onClick={() => void attendance(shift, "in")} type="button">Marcar entrada</button>
                    ) : null}
                    {shift.status === "SCHEDULED" && shift.checkedInAt && !shift.checkedOutAt ? (
                      <button className="row-action row-action-muted" disabled={busyId === shift.id} onClick={() => void attendance(shift, "out")} type="button">Marcar salida</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="field-hint">Puedes marcar tu entrada desde 30 minutos antes del inicio y tu salida hasta el fin del turno.</p>
    </section>
  );
}

/** Rol semanal de la sucursal: crear y cancelar turnos (requiere staff.shifts.manage). */
function Roster() {
  const [start, setStart] = useState(() => weekStart(todayIso()));
  const [shifts, setShifts] = useState<StaffShift[] | null>(null);
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<ShiftKind>("REGULAR");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const days = weekDays(start);

  const load = useCallback(async () => {
    try {
      setShifts(await listShifts({ from: start, to: addDays(start, 6) }));
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar el rol semanal."));
    }
  }, [start]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listStaffMembers().then(setMembers).catch((reason) => setError(errorMessage(reason, "No pudimos cargar al personal de la sucursal.")));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await createShift({ userId, kind, startsAt: boliviaInputToIso(startsAt), endsAt: boliviaInputToIso(endsAt), notes: notes.trim() || null });
      setMessage("Turno creado.");
      setNotes("");
      await load();
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos crear el turno."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancel(shift: StaffShift) {
    if (!cancelReason.trim()) {
      setError("Indica el motivo de la cancelación.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await cancelShift(shift.id, cancelReason.trim());
      setMessage("Turno cancelado.");
      setCancelId(null);
      setCancelReason("");
      await load();
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cancelar el turno."));
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">Sucursal activa</p><h2>Rol semanal</h2></div>
        <div className="staff-week-nav">
          <button className="quiet-button" onClick={() => setStart(addDays(start, -7))} type="button">← Anterior</button>
          <button className="quiet-button" onClick={() => setStart(weekStart(todayIso()))} type="button">Esta semana</button>
          <button className="quiet-button" onClick={() => setStart(addDays(start, 7))} type="button">Siguiente →</button>
        </div>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {message ? <p className="form-success procurement-message" role="status">{message}</p> : null}

      <div className="staff-roster">
        {days.map((day) => {
          const dayShifts = (shifts ?? []).filter((shift) => bolivianDay(shift.startsAt) === day);
          return (
            <div className={`staff-roster-day${day === todayIso() ? " is-today" : ""}`} key={day}>
              <strong>{formatDayLabel(day)}</strong>
              {dayShifts.length ? dayShifts.map((shift) => (
                <div className={`staff-roster-shift${shift.status === "CANCELED" ? " is-canceled" : ""}${shift.kind === "NIGHT_DUTY" ? " is-night" : ""}`} key={shift.id}>
                  <span>{shift.userName}</span>
                  <small>{formatTime(shift.startsAt)} – {formatTime(shift.endsAt)} · {shiftKindLabels[shift.kind]}</small>
                  {shift.checkedInAt ? <small>Entrada {formatTime(shift.checkedInAt)}{shift.checkedOutAt ? ` · Salida ${formatTime(shift.checkedOutAt)}` : ""}</small> : null}
                  {shift.status === "CANCELED" ? <small>Cancelado{shift.cancelReason ? `: ${shift.cancelReason}` : ""}</small> : null}
                  {shift.status === "SCHEDULED" && !shift.checkedInAt ? (
                    cancelId === shift.id ? (
                      <div className="staff-cancel">
                        <input aria-label="Motivo de la cancelación" placeholder="Motivo" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
                        <button className="row-action row-action-danger" onClick={() => void confirmCancel(shift)} type="button">Confirmar</button>
                        <button className="row-action" onClick={() => { setCancelId(null); setCancelReason(""); }} type="button">Volver</button>
                      </div>
                    ) : (
                      <button className="row-action row-action-danger" onClick={() => { setCancelId(shift.id); setCancelReason(""); }} type="button">Cancelar turno</button>
                    )
                  ) : null}
                </div>
              )) : <small className="controlled-sub">Sin turnos</small>}
            </div>
          );
        })}
      </div>

      <h3 className="controlled-subtitle">Programar turno</h3>
      <form className="procurement-form staff-form" onSubmit={submit}>
        <label className="field">
          <span>Persona</span>
          <select required value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Selecciona a la persona</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Tipo</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as ShiftKind)}>
            {(Object.keys(shiftKindLabels) as ShiftKind[]).map((value) => <option key={value} value={value}>{shiftKindLabels[value]}</option>)}
          </select>
        </label>
        <label className="field"><span>Inicio (hora de Bolivia)</span><input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="field"><span>Fin (hora de Bolivia)</span><input required type="datetime-local" value={endsAt} min={startsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        <label className="field"><span>Notas (opcional)</span><input maxLength={300} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Programar turno"}<span>↗</span></button>
      </form>
    </section>
  );
}

/** Personal: mis turnos (todos los miembros) y rol semanal (quien administra turnos). */
export default function StaffPage() {
  const access = useStaffAccess();
  const [restricted, setRestricted] = useState(false);
  const markRestricted = useCallback(() => setRestricted(true), []);

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando personal…</main>;
  const canManage = access.session.permissions.includes("staff.shifts.manage");

  return (
    <main className="procurement-page controlled-page">
      <StaffHeader kicker="Personal · Turnos" title="Turnos y guardias." lede="Consulta tus turnos, marca tu entrada y salida y, si administras al equipo, organiza el rol semanal de la sucursal." />
      <StaffNav />
      {restricted ? <StaffPlanRequired what="La gestión de turnos" /> : (
        <>
          <MyShifts onRestricted={markRestricted} />
          {canManage ? <Roster /> : null}
        </>
      )}
    </main>
  );
}
