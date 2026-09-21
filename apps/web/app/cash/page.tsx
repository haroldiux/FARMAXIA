"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  cashShiftIdempotencyKey,
  createCashShift,
  listCashRegisters,
  listCashShifts,
  listEligibleCashUsers,
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
