"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { currentSession, type AuthSession } from "../lib/session";

export type ControlledAccess = { status: "loading" } | { status: "denied" } | { status: "ready"; session: AuthSession };

/** Loads the session and checks `controlled.read`, following the transfers page pattern. */
export function useControlledAccess(): ControlledAccess {
  const [access, setAccess] = useState<ControlledAccess>({ status: "loading" });
  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((session) => {
        if (!mounted) return;
        setAccess(session.permissions.includes("controlled.read") ? { status: "ready", session } : { status: "denied" });
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

export function ControlledDenied() {
  return (
    <main className="center-state inventory-denied">
      <div>
        <strong>Acceso restringido</strong>
        <p>Tu sesión no tiene permiso para consultar medicamentos controlados.</p>
        <Link href="/dashboard">Volver al resumen</Link>
      </div>
    </main>
  );
}

export function PremiumRequired({ what }: Readonly<{ what: string }>) {
  return (
    <section className="panel controlled-premium" role="status">
      <p className="section-kicker">Plan Premium</p>
      <h2>{what} requiere el plan Premium</h2>
      <p>Tu plan actual no incluye esta funcionalidad. La captura de recetas y el archivo siguen disponibles en todos los planes.</p>
      <Link className="quiet-button" href="/billing">Ver planes y suscripción</Link>
    </section>
  );
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

/** Dates arrive as YYYY-MM-DD (or full ISO); show them in local format without a timezone shift. */
export function formatDay(value: string): string {
  const day = value.slice(0, 10);
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}/${month}/${year}` : value;
}

export function ControlledHeader({ kicker, title, lede }: Readonly<{ kicker: string; title: string; lede: string; children?: ReactNode }>) {
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
