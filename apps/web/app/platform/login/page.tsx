"use client";

import { LoginBackground } from "../../components/login-background";
import { ThemeToggle } from "../../components/theme-toggle";
import { FormEvent, useState } from "react";
import { platformLogin } from "../../lib/platform";

export default function PlatformLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await platformLogin(email, password);
      window.location.assign("/platform");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos iniciar la sesión.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <LoginBackground />
      <ThemeToggle className="login-theme-toggle" />
      <section className="login-intro platform-intro">
        <div className="brand-lockup brand-lockup-dark">
          <div className="brand-mark">F</div>
          <div><strong>FARMAXIA</strong><span>panel de plataforma</span></div>
        </div>
        <div className="intro-copy">
          <p className="eyebrow">Solo operadores</p>
          <h1>Todas las farmacias,<br /><em>un solo lugar.</em></h1>
          <p>Planes, cobros, pagos por revisar y el estado de cada suscripción.</p>
        </div>
        <div className="intro-footer"><span>●</span> Acceso restringido <span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-heading">
          <p className="section-kicker">Operador de plataforma</p>
          <h2>Iniciar sesión.</h2>
          <p>Esta cuenta es distinta a la de una farmacia.</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="field-grid">
            <label className="field field-wide"><span>Correo electrónico</span><input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operador@farmaxia.bo" /></label>
            <label className="field field-wide"><span>Contraseña</span><input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Validando…" : "Entrar al panel"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>
    </main>
  );
}
