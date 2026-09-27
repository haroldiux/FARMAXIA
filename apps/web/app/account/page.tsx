"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  accountProfile,
  activeSessions,
  changePassword,
  describeDevice,
  disableTwoFactor,
  enableTwoFactor,
  revokeOtherSessions,
  revokeSession,
  setupTwoFactor,
  switchBranch,
  type AccountProfile,
  type ActiveSession
} from "../lib/account";
import { formatDate } from "../lib/saas";

export default function AccountPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [enrollment, setEnrollment] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");

  const load = useCallback(async () => {
    const [nextProfile, nextSessions] = await Promise.all([accountProfile(), activeSessions()]);
    setProfile(nextProfile);
    setSessions(nextSessions);
  }, []);

  useEffect(() => {
    load().catch((reason: unknown) => {
      if (reason instanceof Error && reason.message.startsWith("SESSION")) {
        window.location.assign("/");
        return;
      }
      setError(reason instanceof Error ? reason.message : "No pudimos cargar tu cuenta.");
    });
  }, [load]);

  async function run(key: string, action: () => Promise<string | void>): Promise<void> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos completar la acción.");
    } finally {
      setBusy(null);
    }
  }

  function submitPassword(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setError("La nueva contraseña y su confirmación no coinciden.");
      return;
    }
    void run("password", async () => {
      await changePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      await load();
      return "Contraseña actualizada. Cerramos tus sesiones en otros dispositivos.";
    });
  }

  function startTwoFactor(): void {
    void run("2fa", async () => {
      const setup = await setupTwoFactor();
      setEnrollment({ secret: setup.secret, qr: await QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 200 }) });
      setCode("");
    });
  }

  function confirmTwoFactor(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run("2fa", async () => {
      await enableTwoFactor(code);
      setEnrollment(null);
      await load();
      return "Verificación en dos pasos activada. Desde ahora te pediremos el código al iniciar sesión.";
    });
  }

  function turnOffTwoFactor(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run("2fa", async () => {
      await disableTwoFactor(disablePassword);
      setDisablePassword("");
      await load();
      return "Verificación en dos pasos desactivada.";
    });
  }

  if (!profile) {
    return error
      ? <main className="center-state inventory-denied"><div><strong>No pudimos cargar tu cuenta</strong><p>{error}</p><Link href="/dashboard">Volver al resumen</Link></div></main>
      : <main className="center-state"><span className="loading-orb" />Cargando tu cuenta…</main>;
  }

  const others = sessions.filter((session) => !session.current).length;

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">Mi cuenta</p>
          <h1>{profile.displayName}</h1>
          <p className="cash-lede">{profile.email} · {profile.tenantName}</p>
        </div>
      </header>

      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success cash-message" role="status">{notice}</p> : null}

      <section className="account-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Dónde trabajas</p><h2>Farmacia y sucursal</h2></div></div>
          <dl className="detail-list">
            <div><dt>Farmacia</dt><dd>{profile.tenantName}</dd></div>
            <div><dt>Identificador</dt><dd className="mono">{profile.tenantSlug}</dd></div>
            <div><dt>Sucursal actual</dt><dd>{profile.branchName}</dd></div>
          </dl>
          {profile.branches.length > 1 ? (
            <label className="field">
              <span>Cambiar de sucursal</span>
              <select
                disabled={busy === "branch"}
                value={profile.branchId}
                onChange={(event) => {
                  const branchId = event.target.value;
                  void run("branch", async () => {
                    await switchBranch(branchId);
                    window.location.assign("/dashboard");
                  });
                }}
              >
                {profile.branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.branchName} · {branch.branchCode}</option>)}
              </select>
            </label>
          ) : null}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Seguridad</p><h2>Contraseña</h2></div></div>
          <form className="cash-form" onSubmit={submitPassword}>
            <label className="field"><span>Contraseña actual</span><input autoComplete="current-password" required type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} /></label>
            <div className="cash-time-grid">
              <label className="field"><span>Nueva contraseña</span><input autoComplete="new-password" minLength={10} required type="password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} /></label>
              <label className="field"><span>Repítela</span><input autoComplete="new-password" minLength={10} required type="password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} /></label>
            </div>
            <p className="form-note">Mínimo 10 caracteres, con letras y números.{profile.passwordChangedAt ? ` Último cambio: ${formatDate(profile.passwordChangedAt)}.` : ""}</p>
            <button className="secondary-button" disabled={busy === "password"} type="submit">{busy === "password" ? "Guardando…" : "Cambiar contraseña"}</button>
          </form>
        </article>
      </section>

      <section className="panel account-section">
        <div className="panel-heading">
          <div><p className="section-kicker">Seguridad</p><h2>Verificación en dos pasos</h2></div>
          <span className={`subscription-badge ${profile.twoFactorEnabled ? "badge-active" : "badge-canceled"}`}>{profile.twoFactorEnabled ? "Activa" : "Desactivada"}</span>
        </div>
        {profile.twoFactorEnabled ? (
          <form className="two-factor-row" onSubmit={turnOffTwoFactor}>
            <p className="form-note">Al iniciar sesión te pedimos un código de tu app de autenticación. Para desactivarla confirma tu contraseña.</p>
            <input aria-label="Contraseña para desactivar" autoComplete="current-password" className="review-note" required type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} placeholder="Tu contraseña" />
            <button className="row-action row-action-danger" disabled={busy === "2fa"} type="submit">Desactivar</button>
          </form>
        ) : enrollment ? (
          <form className="two-factor-setup" onSubmit={confirmTwoFactor}>
            <img alt="Código QR para tu app de autenticación" height={200} src={enrollment.qr} width={200} />
            <div>
              <ol className="setup-steps">
                <li>Abre Google Authenticator, Microsoft Authenticator o Authy en tu teléfono.</li>
                <li>Escanea el código QR. Si no puedes, ingresa esta clave: <code>{enrollment.secret.match(/.{1,4}/g)?.join(" ")}</code></li>
                <li>Escribe el código de 6 dígitos que aparece en la app.</li>
              </ol>
              <label className="field"><span>Código</span><input autoComplete="one-time-code" className="otp-input" inputMode="numeric" maxLength={6} pattern="\d{6}" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" /></label>
              <div className="two-factor-actions">
                <button className="secondary-button" disabled={busy === "2fa" || code.length !== 6} type="submit">Activar</button>
                <button className="quiet-button" onClick={() => setEnrollment(null)} type="button">Cancelar</button>
              </div>
            </div>
          </form>
        ) : (
          <div className="two-factor-row">
            <p className="form-note">Protege tu cuenta: además de la contraseña, te pediremos un código que cambia cada 30 segundos en tu teléfono.</p>
            <button className="secondary-button" disabled={busy === "2fa"} onClick={startTwoFactor} type="button">Configurar</button>
          </div>
        )}
      </section>

      <section className="panel account-section">
        <div className="panel-heading">
          <div><p className="section-kicker">Dispositivos</p><h2>Sesiones activas</h2></div>
          {others ? <button className="row-action row-action-muted" disabled={busy === "others"} onClick={() => void run("others", async () => {
            const count = await revokeOtherSessions();
            await load();
            return `Cerramos ${count} ${count === 1 ? "sesión" : "sesiones"} en otros dispositivos.`;
          })} type="button">Cerrar las demás</button> : null}
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <div className={`session-row ${session.current ? "is-current" : ""}`} key={session.id}>
              <div>
                <strong>{describeDevice(session.userAgent)}{session.current ? <em>Este dispositivo</em> : null}</strong>
                <small>{[session.tenantName, session.branchName].filter(Boolean).join(" · ")}{session.ipAddress ? ` · IP ${session.ipAddress}` : ""}</small>
                <small>Iniciada {formatDate(session.startedAt, true)} · última actividad {formatDate(session.lastRefreshAt, true)}</small>
              </div>
              {!session.current ? (
                <button className="row-action" disabled={busy === session.id} onClick={() => void run(session.id, async () => {
                  await revokeSession(session.id);
                  await load();
                  return "Sesión cerrada.";
                })} type="button">Cerrar</button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="form-note">Al cerrar una sesión, ese dispositivo deja de poder renovarla y sale en menos de 15 minutos.</p>
      </section>
    </main>
  );
}
