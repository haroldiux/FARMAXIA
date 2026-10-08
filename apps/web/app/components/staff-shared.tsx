"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currentSession, type AuthSession } from "../lib/session";

export type StaffAccess = { status: "loading" } | { status: "ready"; session: AuthSession };

/** Loads the session; every member can open the staff area (own shifts and commissions). */
export function useStaffAccess(): StaffAccess {
  const [access, setAccess] = useState<StaffAccess>({ status: "loading" });
  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((session) => {
        if (mounted) setAccess({ status: "ready", session });
      })
      .catch(() => {
        if (mounted) window.location.assign("/");
      });
    return () => {
      mounted = false;
    };
  }, []);
  return access;
}

export function StaffDenied() {
  return (
    <main className="center-state inventory-denied">
      <div>
        <strong>Acceso restringido</strong>
        <p>Tu sesión no tiene permiso para ver esta pantalla.</p>
        <Link href="/staff">Volver a Personal</Link>
      </div>
    </main>
  );
}

export function StaffPlanRequired({ what, plan = "Profesional" }: Readonly<{ what: string; plan?: string }>) {
  return (
    <section className="panel controlled-premium" role="status">
      <p className="section-kicker">Plan {plan}</p>
      <h2>{what} requiere el plan {plan} o superior</h2>
      <p>Tu plan actual no incluye esta funcionalidad.</p>
      <Link className="quiet-button" href="/billing">Ver planes y suscripción</Link>
    </section>
  );
}

export function StaffHeader({ kicker, title, lede }: Readonly<{ kicker: string; title: string; lede: string }>) {
  return (
    <header className="procurement-header no-print">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p className="procurement-lede">{lede}</p>
      </div>
    </header>
  );
}

export function PeriodPicker({ from, to, onChange }: Readonly<{ from: string; to: string; onChange: (from: string, to: string) => void }>) {
  return (
    <div className="controlled-filters">
      <label className="inventory-filter"><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => onChange(event.target.value, to)} /></label>
      <label className="inventory-filter"><span>Hasta</span><input type="date" value={to} min={from} onChange={(event) => onChange(from, event.target.value)} /></label>
    </div>
  );
}
