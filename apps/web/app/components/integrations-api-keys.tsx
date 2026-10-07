"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createApiKey, errorMessage, listApiKeys, revokeApiKey, type ApiKey, type CreatedApiKey } from "../lib/integrations";
import { formatDate } from "../lib/saas";
import { SecretOnce } from "./integrations-shared";

export function ApiKeysSection({ branchName }: Readonly<{ branchName: string | null }>) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await listApiKeys());
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar las claves de API."));
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      const key = await createApiKey(name.trim());
      setCreated(key);
      setName("");
      return `Clave ${key.name} creada.`;
    });
  }

  function revoke(key: ApiKey): void {
    if (!window.confirm(`¿Revocar la clave ${key.name}? Los sistemas que la usen dejarán de tener acceso de inmediato.`)) return;
    void run(async () => {
      await revokeApiKey(key.id);
      return `Clave ${key.name} revocada.`;
    });
  }

  return (
    <section className="cash-layout">
      <article className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">{branchName ? `Sucursal ${branchName}` : "Sucursal actual"}</p><h2>Claves de API</h2></div>
          <span className="panel-count">{keys.filter((key) => !key.revokedAt).length.toString().padStart(2, "0")}</span>
        </div>
        {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
        {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}
        {loading ? <p className="pos-hint">Cargando…</p> : null}
        {!loading && !keys.length ? (
          <div className="procurement-empty">
            <span className="empty-symbol">✦</span>
            <h3>Aún no hay claves de API.</h3>
            <p>Crea una para que un sistema externo consulte tu catálogo, precios y stock.</p>
          </div>
        ) : null}
        {keys.length ? (
          <div className="controlled-table-wrap">
            <table className="invoice-table controlled-table">
              <thead>
                <tr><th>Nombre</th><th>Prefijo</th><th>Creada</th><th>Último uso</th><th>Estado</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td><strong>{key.name}</strong></td>
                    <td><code>{key.prefix}…</code></td>
                    <td>{formatDate(key.createdAt)}</td>
                    <td>{key.lastUsedAt ? formatDate(key.lastUsedAt, true) : "Nunca"}</td>
                    <td>
                      <span className={`order-status ${key.revokedAt ? "order-canceled" : "order-received"}`}>
                        {key.revokedAt ? `Revocada ${formatDate(key.revokedAt)}` : "Activa"}
                      </span>
                    </td>
                    <td>
                      {key.revokedAt ? <span className="action-muted">—</span> : (
                        <button className="row-action row-action-danger" disabled={busy} onClick={() => revoke(key)} type="button">Revocar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <aside className="panel cash-form-panel">
        <form className="cash-form" onSubmit={submit}>
          <div className="panel-heading"><div><p className="section-kicker">Alta</p><h2>Nueva clave</h2></div></div>
          <p className="action-context">La clave solo puede leer datos de esta sucursal (catálogo, precios y stock disponible).</p>
          <label className="field">
            <span>Nombre</span>
            <input maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Tienda en línea" />
          </label>
          <button className="primary-button" disabled={busy || !name.trim()} type="submit">{busy ? "Creando…" : "Crear clave"}<span aria-hidden="true">↗</span></button>
        </form>
        {created ? <SecretOnce label={`Clave de API · ${created.name}`} value={created.key} onDismiss={() => setCreated(null)} /> : null}
      </aside>
    </section>
  );
}
