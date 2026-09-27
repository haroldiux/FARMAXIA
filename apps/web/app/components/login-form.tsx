"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { completeTotpLogin, login, type BranchOption } from "../lib/session";

type Step = { kind: "credentials" } | { kind: "branch"; options: BranchOption[] } | { kind: "totp"; challengeToken: string };

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenant, setTenant] = useState("");
  const [showTenant, setShowTenant] = useState(false);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos iniciar la sesión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function attempt(branch?: BranchOption): Promise<void> {
    const result = await login({
      email,
      password,
      tenant: branch?.tenantId ?? (tenant.trim() || undefined),
      branchId: branch?.branchId
    });
    if (result.status === "ok") {
      router.push("/dashboard");
    } else if (result.status === "branch") {
      setStep({ kind: "branch", options: result.options });
    } else {
      setCode("");
      setStep({ kind: "totp", challengeToken: result.challengeToken });
    }
  }

  function submitCredentials(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(() => attempt());
  }

  function submitCode(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (step.kind !== "totp") return;
    void run(async () => {
      await completeTotpLogin(step.challengeToken, code);
      router.push("/dashboard");
    });
  }

  function back(): void {
    setError(null);
    setStep({ kind: "credentials" });
  }

  if (step.kind === "branch") {
    const tenants = [...new Map(step.options.map((option) => [option.tenantId, option.tenantName])).entries()];
    return (
      <div className="login-form login-step">
        <p className="login-step-title">¿Dónde vas a trabajar hoy?</p>
        {tenants.map(([tenantId, tenantName]) => (
          <div className="branch-group" key={tenantId}>
            {tenants.length > 1 ? <p className="branch-group-name">{tenantName}</p> : null}
            <div className="branch-options">
              {step.options.filter((option) => option.tenantId === tenantId).map((option) => (
                <button className="branch-option" disabled={isSubmitting} key={option.branchId} onClick={() => void run(() => attempt(option))} type="button">
                  <strong>{option.branchName}</strong>
                  <span>{option.branchCode}{tenants.length === 1 ? ` · ${option.tenantName}` : ""}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="link-button" onClick={back} type="button">← Usar otra cuenta</button>
      </div>
    );
  }

  if (step.kind === "totp") {
    return (
      <form className="login-form login-step" onSubmit={submitCode}>
        <p className="login-step-title">Verificación en dos pasos</p>
        <p className="form-note login-step-copy">Abre tu app de autenticación (Google Authenticator, Microsoft Authenticator…) y escribe el código de 6 dígitos.</p>
        <label className="field">
          <span>Código</span>
          <input autoComplete="one-time-code" autoFocus className="otp-input" inputMode="numeric" maxLength={6} pattern="\d{6}" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={isSubmitting || code.length !== 6} type="submit">
          {isSubmitting ? "Verificando…" : "Verificar y entrar"}
          <span aria-hidden="true">↗</span>
        </button>
        <button className="link-button" onClick={back} type="button">← Volver</button>
      </form>
    );
  }

  return (
    <form className="login-form" onSubmit={submitCredentials}>
      <div className="field-grid">
        <label className="field field-wide">
          <span>Correo electrónico</span>
          <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@farmacia.com" />
        </label>
        <label className="field field-wide">
          <span>Contraseña</span>
          <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
        </label>
        {showTenant ? (
          <label className="field field-wide">
            <span>Identificador de la farmacia <small>opcional</small></span>
            <input autoCapitalize="none" value={tenant} onChange={(event) => setTenant(event.target.value)} placeholder="Ej. farmacia-central" />
          </label>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Validando acceso…" : "Entrar al backoffice"}
        <span aria-hidden="true">↗</span>
      </button>
      {!showTenant ? (
        <button className="link-button" onClick={() => setShowTenant(true)} type="button">¿Trabajas en varias farmacias? Indica cuál</button>
      ) : null}
      <p className="form-note">Si tienes acceso a varias sucursales, te preguntaremos en cuál vas a trabajar.</p>
    </form>
  );
}
