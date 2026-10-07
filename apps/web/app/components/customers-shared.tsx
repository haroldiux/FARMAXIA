"use client";

import Link from "next/link";
import { useShellSession } from "./app-shell";

/** Session of the shell (the pages render inside it, so it is always there); permission checks live in the pages. */
export function useCrmSession() {
  const shell = useShellSession();
  return { session: shell?.session ?? null, features: shell?.subscription?.features };
}

export function CrmDenied() {
  return (
    <main className="center-state inventory-denied">
      <div>
        <strong>Acceso restringido</strong>
        <p>Tu sesión no tiene permiso para ver esta pantalla.</p>
        <Link href="/dashboard">Volver al resumen</Link>
      </div>
    </main>
  );
}

export function CrmPlanRequired({ what, plan }: Readonly<{ what: string; plan: string }>) {
  return (
    <section className="panel controlled-premium" role="status">
      <p className="section-kicker">Plan {plan}</p>
      <h2>{what} requiere el plan {plan} o superior</h2>
      <p>Tu plan actual no incluye esta funcionalidad.</p>
      <Link className="quiet-button" href="/billing">Ver planes y suscripción</Link>
    </section>
  );
}

export function CrmHeader({ kicker, title, lede }: Readonly<{ kicker: string; title: string; lede: string }>) {
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
