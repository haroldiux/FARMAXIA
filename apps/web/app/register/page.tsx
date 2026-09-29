"use client";

import { LoginBackground } from "../components/login-background";
import { ThemeToggle } from "../components/theme-toggle";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { formatBob, formatDate, listPublicPlans, registerPharmacy, type PublicPlan, type RegisterInput, type RegisterResult } from "../lib/saas";

const emptyForm: RegisterInput = {
  pharmacyName: "",
  legalName: "",
  taxId: "",
  branchName: "Casa Matriz",
  ownerName: "",
  email: "",
  password: "",
  planCode: "BASICO"
};

const resourceNames: Record<string, [singular: string, plural: string]> = {
  branches: ["sucursal", "sucursales"],
  cash_registers: ["caja", "cajas"],
  users: ["usuario", "usuarios"]
};

function limitLabel(resource: string, value: number | null | undefined): string {
  const [singular, plural] = resourceNames[resource] ?? [resource, resource];
  if (value === null || value === undefined) {
    return `${plural.charAt(0).toUpperCase()}${plural.slice(1)} ilimitad${resource === "users" ? "os" : "as"}`;
  }
  return `${value} ${value === 1 ? singular : plural}`;
}

export default function RegisterPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [form, setForm] = useState<RegisterInput>(emptyForm);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);

  useEffect(() => {
    listPublicPlans().then(setPlans).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar los planes."));
  }, []);

  function update(field: keyof RegisterInput, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (form.password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    try {
      setResult(await registerPharmacy(form));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar la farmacia.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="login-page">
      <LoginBackground />
      <ThemeToggle className="login-theme-toggle" />
      <section className="login-intro">
        <div className="brand-lockup brand-lockup-dark">
          <div className="brand-mark">F</div>
          <div><strong>FARMAXIA</strong><span>operación inteligente</span></div>
        </div>
        <div className="intro-copy">
          <p className="eyebrow">Prueba gratis 7 días</p>
          <h1>Tu farmacia,<br /><em>en orden.</em></h1>
          <p>Registra tu farmacia en un minuto. Empiezas con la sucursal, el almacén y la caja listos para operar.</p>
        </div>
        <div className="intro-footer"><span>●</span> Sin tarjeta · Cancela cuando quieras <span>2026</span></div>
      </section>

      <section className="login-panel register-panel">
        {result ? (
          <div className="register-success" role="status">
            <p className="section-kicker">Farmacia registrada</p>
            <h2>¡Bienvenido a FARMAXIA!</h2>
            <p>Tu prueba gratuita dura hasta el <strong>{formatDate(result.trialEndsAt)}</strong>. Ya iniciaste sesión.</p>
            <div className="credential-card">
              <p>Para volver a entrar usa tu correo y tu contraseña.</p>
              <dl>
                <div><dt>Correo</dt><dd>{form.email.trim().toLowerCase()}</dd></div>
                <div><dt>Identificador de tu farmacia</dt><dd>{result.tenantSlug}</dd></div>
              </dl>
              <p className="form-note">El identificador solo se pide si algún día trabajas en más de una farmacia.</p>
            </div>
            <Link className="primary-button" href="/dashboard">Entrar a mi farmacia<span aria-hidden="true">↗</span></Link>
          </div>
        ) : (
          <>
            <div className="login-panel-heading">
              <p className="section-kicker">Crear cuenta</p>
              <h2>Registra tu farmacia.</h2>
              <p>Elige un plan: puedes cambiarlo después.</p>
            </div>
            <form className="register-form" onSubmit={submit}>
              <fieldset className="plan-picker">
                <legend>Plan</legend>
                {plans.length ? plans.map((plan) => (
                  <label className={`plan-option ${form.planCode === plan.code ? "is-selected" : ""}`} key={plan.code}>
                    <input checked={form.planCode === plan.code} name="plan" onChange={() => update("planCode", plan.code)} type="radio" value={plan.code} />
                    <span className="plan-option-head"><strong>{plan.name}</strong><em>{formatBob(plan.priceMonthlyBob)}<small>/mes</small></em></span>
                    <span className="plan-option-copy">{plan.description}</span>
                    <span className="plan-option-limits">
                      {(["branches", "cash_registers", "users"] as const).map((resource) => (
                        <span key={resource}>{limitLabel(resource, plan.quotas[resource])}</span>
                      ))}
                    </span>
                  </label>
                )) : <p className="form-note">Cargando planes…</p>}
              </fieldset>

              <div className="field-grid">
                <label className="field field-wide"><span>Nombre de la farmacia</span><input autoComplete="organization" maxLength={160} minLength={2} required value={form.pharmacyName} onChange={(event) => update("pharmacyName", event.target.value)} placeholder="Ej. Farmacia Santa Cruz" /></label>
                <label className="field"><span>Razón social</span><input maxLength={200} minLength={2} required value={form.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Ej. Farmacia Santa Cruz S.R.L." /></label>
                <label className="field"><span>NIT</span><input inputMode="numeric" maxLength={20} minLength={5} pattern="\d{5,20}" required value={form.taxId} onChange={(event) => update("taxId", event.target.value)} placeholder="Solo números" /></label>
                <label className="field field-wide"><span>Nombre de la sucursal principal</span><input maxLength={160} minLength={2} required value={form.branchName} onChange={(event) => update("branchName", event.target.value)} /></label>
                <label className="field field-wide"><span>Tu nombre</span><input autoComplete="name" maxLength={160} minLength={2} required value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} placeholder="Nombre y apellido" /></label>
                <label className="field field-wide"><span>Correo electrónico</span><input autoComplete="email" required type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="tu@farmacia.com" /></label>
                <label className="field"><span>Contraseña</span><input autoComplete="new-password" maxLength={128} minLength={10} required type="password" value={form.password} onChange={(event) => update("password", event.target.value)} /></label>
                <label className="field"><span>Repite la contraseña</span><input autoComplete="new-password" maxLength={128} minLength={10} required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              </div>
              <p className="form-note">Mínimo 10 caracteres, con letras y números.</p>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button className="primary-button" disabled={saving || !plans.length} type="submit">
                {saving ? "Creando tu farmacia…" : "Crear farmacia y empezar la prueba"}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className="login-footer auth-switch">¿Ya tienes una cuenta? <Link href="/">Inicia sesión</Link></p>
          </>
        )}
      </section>
    </main>
  );
}
