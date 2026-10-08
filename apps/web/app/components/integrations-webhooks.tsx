"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createWebhook,
  deliveryStatusLabels,
  errorMessage,
  listWebhookDeliveries,
  listWebhookEventTypes,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
  type DeliveryStatus,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType
} from "../lib/integrations";
import { formatDate } from "../lib/saas";
import { SecretOnce } from "./integrations-shared";

type Panel = { kind: "none" } | { kind: "create" } | { kind: "edit"; endpoint: WebhookEndpoint };

const emptyForm = { url: "", description: "", eventTypes: [] as string[] };
const DELIVERY_PAGE = 50;

const deliveryStatusClass: Record<DeliveryStatus, string> = { PENDING: "order-open", SUCCEEDED: "order-received", FAILED: "order-overdue" };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function DeliveryLog({ endpointId }: Readonly<{ endpointId: string }>) {
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<WebhookDelivery[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listWebhookDeliveries(endpointId, { status: status || undefined, limit: DELIVERY_PAGE, offset });
      setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setHasMore(page.items.length === DELIVERY_PAGE);
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar las entregas."));
    } finally {
      setLoading(false);
    }
  }, [endpointId, status]);

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="integrations-deliveries">
      <div className="controlled-filters">
        <label className="inventory-filter">
          <span>Estado</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            {(Object.keys(deliveryStatusLabels) as DeliveryStatus[]).map((value) => <option key={value} value={value}>{deliveryStatusLabels[value]}</option>)}
          </select>
        </label>
        <button className="row-action" disabled={loading} onClick={() => void load(0)} type="button">Actualizar</button>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {!loading && !error && !items.length ? <p className="pos-hint">Aún no hay entregas{status ? " con este estado" : ""}.</p> : null}
      {items.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table">
            <thead>
              <tr><th>Evento</th><th>Estado</th><th>Intentos</th><th>Última respuesta</th><th>Fechas</th></tr>
            </thead>
            <tbody>
              {items.map((delivery) => {
                const known = delivery.status as DeliveryStatus;
                return (
                  <tr key={delivery.id}>
                    <td><code>{delivery.eventType}</code></td>
                    <td><span className={`order-status ${deliveryStatusClass[known] ?? "order-open"}`}>{deliveryStatusLabels[known] ?? delivery.status}</span></td>
                    <td>{delivery.attempts}</td>
                    <td>
                      {delivery.lastStatusCode !== null ? <strong>HTTP {delivery.lastStatusCode}</strong> : delivery.lastAttemptAt ? null : <span className="action-muted">Sin intentos</span>}
                      {delivery.lastError ? <small className="integrations-error-text">{delivery.lastError}</small> : null}
                    </td>
                    <td>
                      <small>Creada {formatDate(delivery.createdAt, true)}</small>
                      {delivery.lastAttemptAt ? <small>Último intento {formatDate(delivery.lastAttemptAt, true)}</small> : null}
                      {delivery.deliveredAt ? <small>Entregada {formatDate(delivery.deliveredAt, true)}</small> : null}
                      {delivery.status === "PENDING" ? <small>Próximo intento {formatDate(delivery.nextAttemptAt, true)}</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {loading ? <p className="pos-hint">Cargando…</p> : null}
      {hasMore && !loading ? <button className="quiet-button" onClick={() => void load(items.length)} type="button">Cargar más</button> : null}
    </div>
  );
}

export function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [form, setForm] = useState(emptyForm);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const labels = useMemo(() => new Map(eventTypes.map((item) => [item.type, item.label])), [eventTypes]);

  const load = useCallback(async () => {
    try {
      const [nextEndpoints, nextTypes] = await Promise.all([listWebhooks(), listWebhookEventTypes()]);
      setEndpoints(nextEndpoints);
      setEventTypes(nextTypes);
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar los webhooks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos completar la acción."));
    } finally {
      setBusy(false);
    }
  }

  function open(next: Panel): void {
    setPanel(next);
    setError(null);
    setNotice(null);
    setForm(next.kind === "edit"
      ? { url: next.endpoint.url, description: next.endpoint.description ?? "", eventTypes: next.endpoint.eventTypes }
      : emptyForm);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload = { url: form.url.trim(), description: form.description.trim(), eventTypes: form.eventTypes };
    if (panel.kind === "create") {
      void run(async () => {
        const endpoint = await createWebhook(payload);
        setSecret({ label: `Secreto de firma · ${endpoint.url}`, value: endpoint.secret });
        setPanel({ kind: "none" });
        return "Webhook creado.";
      });
    } else if (panel.kind === "edit") {
      const { endpoint } = panel;
      void run(async () => {
        await updateWebhook(endpoint.id, payload);
        setPanel({ kind: "none" });
        return "Webhook actualizado.";
      });
    }
  }

  function toggleActive(endpoint: WebhookEndpoint): void {
    if (endpoint.isActive && !window.confirm(`¿Desactivar el webhook ${endpoint.url}? Los eventos nuevos quedarán pendientes hasta que lo reactives.`)) return;
    void run(async () => {
      await updateWebhook(endpoint.id, { isActive: !endpoint.isActive });
      return endpoint.isActive ? "Webhook desactivado." : "Webhook reactivado.";
    });
  }

  function rotate(endpoint: WebhookEndpoint): void {
    if (!window.confirm(`¿Rotar el secreto de ${endpoint.url}? El secreto actual dejará de ser válido de inmediato y deberás actualizarlo en el sistema receptor.`)) return;
    void run(async () => {
      const rotated = await rotateWebhookSecret(endpoint.id);
      setSecret({ label: `Nuevo secreto de firma · ${rotated.url}`, value: rotated.secret });
      return "Secreto rotado.";
    });
  }

  const allSelected = form.eventTypes.includes("*");

  return (
    <section className="cash-layout">
      <article className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Eventos salientes</p><h2>Webhooks</h2></div>
          <button className="secondary-button" onClick={() => open({ kind: "create" })} type="button">+ Nuevo webhook</button>
        </div>
        {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
        {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}
        {loading ? <p className="pos-hint">Cargando…</p> : null}
        {!loading && !endpoints.length ? (
          <div className="procurement-empty">
            <span className="empty-symbol">✦</span>
            <h3>Aún no hay webhooks.</h3>
            <p>Registra una URL para recibir avisos firmados de ventas, caja y traspasos.</p>
          </div>
        ) : null}
        <div className="order-list">
          {endpoints.map((endpoint) => (
            <article className={`order-card${endpoint.isActive ? "" : " is-inactive"}`} key={endpoint.id}>
              <div className="order-card-head">
                <div>
                  <strong className="integrations-url">{endpoint.url}</strong>
                  <small>{endpoint.description || "Sin descripción"} · Secreto <code>{endpoint.secretHint}</code></small>
                </div>
                <span className={`order-status ${endpoint.isActive ? "order-received" : "order-canceled"}`}>{endpoint.isActive ? "Activo" : "Inactivo"}</span>
              </div>
              <div className="chip-row">
                {endpoint.eventTypes.map((type) => <span className="chip" key={type}>{labels.get(type) ?? type}</span>)}
              </div>
              <div className="order-card-foot">
                <small className="action-muted">Creado {formatDate(endpoint.createdAt)}</small>
                <div className="user-actions">
                  <button className="row-action" onClick={() => setExpanded(expanded === endpoint.id ? null : endpoint.id)} aria-expanded={expanded === endpoint.id} type="button">
                    {expanded === endpoint.id ? "Ocultar entregas" : "Ver entregas"}
                  </button>
                  <button className="row-action" onClick={() => open({ kind: "edit", endpoint })} type="button">Editar</button>
                  <button className="row-action" disabled={busy} onClick={() => rotate(endpoint)} type="button">Rotar secreto</button>
                  <button className={`row-action${endpoint.isActive ? " row-action-danger" : ""}`} disabled={busy} onClick={() => toggleActive(endpoint)} type="button">
                    {endpoint.isActive ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
              {expanded === endpoint.id ? <DeliveryLog endpointId={endpoint.id} /> : null}
            </article>
          ))}
        </div>
      </article>

      <aside className="panel cash-form-panel">
        {secret ? <SecretOnce label={secret.label} value={secret.value} onDismiss={() => setSecret(null)} /> : null}
        {panel.kind === "none" ? (
          secret ? null : (
            <div className="inventory-action-placeholder billing-placeholder">
              <span className="empty-symbol">✦</span>
              <h2>Avisos en tiempo real</h2>
              <p>Cada evento se envía por POST con una firma HMAC. Si la URL falla, se reintenta hasta 8 veces.</p>
            </div>
          )
        ) : (
          <form className="cash-form" onSubmit={submit}>
            <div className="panel-heading">
              <div><p className="section-kicker">{panel.kind === "create" ? "Alta" : "Edición"}</p><h2>{panel.kind === "create" ? "Nuevo webhook" : "Editar webhook"}</h2></div>
              <button aria-label="Cerrar" className="close-action" onClick={() => setPanel({ kind: "none" })} type="button">×</button>
            </div>
            <label className="field">
              <span>URL de destino</span>
              <input maxLength={500} required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://mi-sistema.com/webhooks/farmaxia" />
            </label>
            <p className="form-note">Debe usar HTTPS (solo localhost puede usar HTTP).</p>
            <label className="field">
              <span>Descripción <small>opcional</small></span>
              <input maxLength={200} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </label>
            <fieldset className="check-fieldset">
              <legend>Eventos</legend>
              {eventTypes.map((item) => (
                <label className={`check-option${allSelected && item.type !== "*" ? " is-locked" : ""}`} key={item.type}>
                  <input
                    checked={form.eventTypes.includes(item.type) || (allSelected && item.type !== "*")}
                    disabled={allSelected && item.type !== "*"}
                    onChange={() => setForm({ ...form, eventTypes: item.type === "*" ? (allSelected ? [] : ["*"]) : toggle(form.eventTypes, item.type) })}
                    type="checkbox"
                  />
                  <span><strong>{item.label}</strong><small>{item.type}</small></span>
                </label>
              ))}
            </fieldset>
            <button className="primary-button" disabled={busy || !form.url.trim() || !form.eventTypes.length} type="submit">
              {busy ? "Guardando…" : panel.kind === "create" ? "Crear webhook" : "Guardar cambios"}<span aria-hidden="true">↗</span>
            </button>
          </form>
        )}
      </aside>
    </section>
  );
}
