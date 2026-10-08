"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShellSession } from "../components/app-shell";
import { ApiKeysSection } from "../components/integrations-api-keys";
import { IntegrationsPlanRequired } from "../components/integrations-shared";
import { WebhooksSection } from "../components/integrations-webhooks";
import { publicApiBaseUrl } from "../lib/integrations";
import { planAllows } from "../lib/plan";

/** How long to wait for the plan snapshot before trusting the API to enforce the plan. */
const PLAN_WAIT_MS = 4000;

type Tab = "keys" | "webhooks" | "usage";

const verifyExample = `// Node.js: verificar X-Farmaxia-Signature con el cuerpo crudo (sin parsear)
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, header, rawBody) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const expected = createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300;
  return fresh && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}`;

function UsagePanel() {
  return (
    <section className="cash-layout integrations-usage">
      <article className="panel">
        <div className="panel-heading"><div><p className="section-kicker">Solo lectura</p><h2>API pública</h2></div></div>
        <p className="action-context">Envía la clave en el encabezado <code>X-Api-Key</code>. Cada clave ve solo los datos de su sucursal, con un límite de 120 solicitudes por minuto.</p>
        <dl className="integrations-reference">
          <div><dt>URL base</dt><dd><code>{publicApiBaseUrl}</code></dd></div>
          <div><dt>GET /products?search=&amp;limit=&amp;offset=</dt><dd>Busca productos con sus presentaciones, precio vigente y stock disponible.</dd></div>
          <div><dt>GET /products/:productId</dt><dd>Detalle de un producto.</dd></div>
          <div><dt>GET /stock?presentationId=&amp;limit=&amp;offset=</dt><dd>Stock disponible por presentación.</dd></div>
        </dl>
        <pre className="integrations-code"><code>{`curl -H "X-Api-Key: fxk_..." "${publicApiBaseUrl}/products?search=paracetamol"`}</code></pre>
        <p className="form-note">Respuestas de error: 401 clave inválida o revocada, 402 suscripción inactiva, 403 plan sin API pública, 429 límite de solicitudes.</p>
      </article>
      <article className="panel">
        <div className="panel-heading"><div><p className="section-kicker">Seguridad</p><h2>Verificar webhooks</h2></div></div>
        <p className="action-context">
          Cada envío incluye <code>X-Farmaxia-Signature: t=&lt;unix&gt;,v1=&lt;firma&gt;</code>, donde la firma es HMAC-SHA256 en hexadecimal del texto <code>&lt;t&gt;.&lt;cuerpo&gt;</code> con el secreto del webhook.
          Rechaza firmas con más de 5 minutos de antigüedad y responde 2xx para confirmar la recepción.
        </p>
        <pre className="integrations-code"><code>{verifyExample}</code></pre>
        <p className="form-note">También recibes <code>X-Farmaxia-Event</code> y <code>X-Farmaxia-Delivery</code> (identificador único de la entrega, útil para evitar procesar dos veces).</p>
      </article>
    </section>
  );
}

export default function IntegrationsPage() {
  const shell = useShellSession();
  const [tab, setTab] = useState<Tab>("keys");
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PLAN_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!shell) return <main className="center-state"><span className="loading-orb" />Cargando integraciones…</main>;
  if (!shell.session.permissions.includes("integrations.manage")) {
    return (
      <main className="center-state inventory-denied">
        <div>
          <strong>Acceso restringido</strong>
          <p>Solo el propietario puede administrar las integraciones.</p>
          <Link href="/dashboard">Volver al resumen</Link>
        </div>
      </main>
    );
  }

  const planKnown = shell.subscription !== null || waited;
  const locked = !planAllows(shell.subscription?.features, "public_api");
  const branchName = shell.account?.branches.find((branch) => branch.branchId === shell.session.branchId)?.branchName ?? null;

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Integraciones.</h1>
          <p className="cash-lede">Conecta sistemas externos: claves de API de solo lectura para tu catálogo, precios y stock, y webhooks firmados para recibir eventos de ventas, caja y traspasos.</p>
        </div>
      </header>

      {!planKnown ? <p className="pos-hint">Verificando tu plan…</p> : locked ? <IntegrationsPlanRequired /> : (
        <>
          <div className="segmented" role="tablist" aria-label="Secciones">
            <button aria-selected={tab === "keys"} className={tab === "keys" ? "is-active" : ""} onClick={() => setTab("keys")} role="tab" type="button">Claves de API</button>
            <button aria-selected={tab === "webhooks"} className={tab === "webhooks" ? "is-active" : ""} onClick={() => setTab("webhooks")} role="tab" type="button">Webhooks</button>
            <button aria-selected={tab === "usage"} className={tab === "usage" ? "is-active" : ""} onClick={() => setTab("usage")} role="tab" type="button">Cómo usar</button>
          </div>
          {tab === "keys" ? <ApiKeysSection branchName={branchName} /> : tab === "webhooks" ? <WebhooksSection /> : <UsagePanel />}
        </>
      )}
    </main>
  );
}
