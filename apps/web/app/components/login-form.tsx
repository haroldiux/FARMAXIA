"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../lib/session";

const emptyForm = {
  email: "",
  password: "",
  tenantId: "",
  branchId: ""
};

export function LoginForm() {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof typeof emptyForm, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(form);
      router.push("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos iniciar la sesión.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field-grid">
        <label className="field field-wide">
          <span>Correo electrónico</span>
          <input
            autoComplete="email"
            required
            type="email"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="tu@farmacia.com"
          />
        </label>
        <label className="field field-wide">
          <span>Contraseña</span>
          <input
            autoComplete="current-password"
            required
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            placeholder="••••••••"
          />
        </label>
        <label className="field">
          <span>ID de organización</span>
          <input
            required
            type="text"
            value={form.tenantId}
            onChange={(event) => updateField("tenantId", event.target.value)}
            placeholder="UUID del tenant"
          />
        </label>
        <label className="field">
          <span>ID de sucursal</span>
          <input
            required
            type="text"
            value={form.branchId}
            onChange={(event) => updateField("branchId", event.target.value)}
            placeholder="UUID de la sucursal"
          />
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Validando acceso…" : "Entrar al backoffice"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="form-note">
        El tenant y la sucursal se validan contra tu membresía. Esos identificadores no conceden acceso por sí solos.
      </p>
    </form>
  );
}
