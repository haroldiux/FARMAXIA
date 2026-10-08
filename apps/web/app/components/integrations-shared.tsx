"use client";

import Link from "next/link";
import { useState } from "react";

export function IntegrationsPlanRequired() {
  return (
    <section className="panel controlled-premium" role="status">
      <p className="section-kicker">Plan Premium</p>
      <h2>Las integraciones requieren el plan Premium</h2>
      <p>Tu plan actual no incluye la API pública ni los webhooks.</p>
      <Link className="quiet-button" href="/billing">Ver planes y suscripción</Link>
    </section>
  );
}

/** Highlighted box for a credential the API returns only once (API key or webhook secret). */
export function SecretOnce({ label, value, onDismiss }: Readonly<{ label: string; value: string; onDismiss: () => void }>) {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => setCopied(false));
  }

  return (
    <div className="credential-card integrations-secret" role="status">
      <p>Copia este valor ahora: no se volverá a mostrar.</p>
      <dl>
        <div>
          <dt>{label}</dt>
          <dd><code>{value}</code></dd>
        </div>
      </dl>
      <div className="user-actions">
        <button className="secondary-button" onClick={copy} type="button">{copied ? "Copiado ✓" : "Copiar"}</button>
        <button className="row-action" onClick={onDismiss} type="button">Ya lo guardé</button>
      </div>
    </div>
  );
}
