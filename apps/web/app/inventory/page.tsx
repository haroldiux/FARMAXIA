"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { currentSession, logout, type AuthSession } from "../lib/session";
import {
  listExpiryAlerts,
  listWarehouses,
  quarantineBatch,
  recordWaste,
  releaseQuarantine,
  type BatchStatus,
  type ExpiryAlert,
  type QuarantineReasonCode,
  type Warehouse
} from "../lib/inventory";

type ActionKind = "QUARANTINE" | "RELEASE" | "WASTE";

interface ActionState {
  kind: ActionKind;
  alert: ExpiryAlert;
}

const horizons = [7, 30, 90];

function statusLabel(status: ExpiryAlert["status"]): string {
  return status === "EXPIRED" ? "Vencido" : "Por vencer";
}

function batchStatusLabel(status: BatchStatus): string {
  if (status === "QUARANTINED") {
    return "En cuarentena";
  }
  if (status === "DISPOSED") {
    return "Dispuesto";
  }
  return "Disponible";
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-BO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function actionLabel(kind: ActionKind): string {
  if (kind === "QUARANTINE") {
    return "Cuarentenar lote";
  }
  if (kind === "RELEASE") {
    return "Liberar lote";
  }
  return "Registrar merma";
}

export default function InventoryPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [horizonDays, setHorizonDays] = useState(30);
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [action, setAction] = useState<ActionState | null>(null);
  const [reasonCode, setReasonCode] = useState<QuarantineReasonCode>("QUALITY");
  const [reason, setReason] = useState("");
  const [temperatureCelsius, setTemperatureCelsius] = useState("");
  const [wasteQuantity, setWasteQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      let value: AuthSession;
      try {
        value = await currentSession();
      } catch {
        if (mounted) {
          window.location.assign("/");
        }
        return;
      }
      try {
        if (!mounted) {
          return;
        }
        setSession(value);
        if (!value.permissions.includes("inventory.manage")) {
          setLoading(false);
          return;
        }
        const result = await listWarehouses();
        if (!mounted) {
          return;
        }
        setWarehouses(result.items);
        const firstWarehouse = result.items[0];
        if (firstWarehouse) {
          setSelectedWarehouseId(firstWarehouse.id);
          await loadAlerts(firstWarehouse.id, 30);
        }
      } catch (reasonValue) {
        if (mounted) {
          setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar inventario.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  async function loadAlerts(warehouseId: string, days: number): Promise<void> {
    const version = ++requestVersion.current;
    setLoadingAlerts(true);
    setError(null);
    try {
      const result = await listExpiryAlerts(warehouseId, days);
      if (version === requestVersion.current) {
        setAlerts(result);
      }
    } catch (reasonValue) {
      if (version === requestVersion.current) {
        setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos cargar alertas.");
      }
    } finally {
      if (version === requestVersion.current) {
        setLoadingAlerts(false);
      }
    }
  }

  function changeWarehouse(value: string): void {
    setSelectedWarehouseId(value);
    if (value) {
      void loadAlerts(value, horizonDays);
    }
  }

  function changeHorizon(value: string): void {
    const days = Number(value);
    setHorizonDays(days);
    if (selectedWarehouseId) {
      void loadAlerts(selectedWarehouseId, days);
    }
  }

  function openAction(kind: ActionKind, alert: ExpiryAlert): void {
    setAction({ kind, alert });
    setReason("");
    setReasonCode("QUALITY");
    setTemperatureCelsius("");
    setWasteQuantity("1");
    setNotice(null);
    setError(null);
  }

  async function submitAction(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!action || !selectedWarehouseId || !reason.trim()) {
      return;
    }
    if (action.kind === "WASTE" && (!Number.isSafeInteger(Number(wasteQuantity)) || Number(wasteQuantity) < 1)) {
      setError("La cantidad de merma debe ser un entero positivo.");
      return;
    }
    if (action.kind === "QUARANTINE" && reasonCode === "COLD_CHAIN" && !temperatureCelsius.trim()) {
      setError("Registra la temperatura para una incidencia de cadena de frío.");
      return;
    }
    const confirmed = window.confirm(`¿Confirmas la acción «${actionLabel(action.kind)}» para el lote ${action.alert.lotCode}?`);
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (action.kind === "QUARANTINE") {
        await quarantineBatch(action.alert.batchId, {
          warehouseId: selectedWarehouseId,
          reasonCode,
          reason: reason.trim(),
          temperatureCelsius: temperatureCelsius.trim() ? Number(temperatureCelsius) : undefined
        });
      } else if (action.kind === "RELEASE") {
        await releaseQuarantine(action.alert.batchId, {
          warehouseId: selectedWarehouseId,
          reason: reason.trim()
        });
      } else {
        await recordWaste(action.alert.batchId, {
          warehouseId: selectedWarehouseId,
          quantityBase: Number(wasteQuantity),
          reason: reason.trim()
        });
      }
      setNotice(`${actionLabel(action.kind)} aplicado correctamente.`);
      setAction(null);
      await loadAlerts(selectedWarehouseId, horizonDays);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No pudimos aplicar la operación.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut(): Promise<void> {
    await logout();
    window.location.assign("/");
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando inventario…</main>;
  }
  if (!session) {
    return null;
  }
  if (!session.permissions.includes("inventory.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para administrar inventario.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">F3 · Inventario operativo</p>
          <h1>Que nada se pierda antes de tiempo.</h1>
          <p className="inventory-lede">Revisa los lotes próximos a vencer y decide qué hacer con cada incidencia desde la sucursal activa.</p>
        </div>
        <button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button>
      </header>

      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success inventory-message" role="status">{notice}</p> : null}

      <section className="inventory-toolbar" aria-label="Filtros de inventario">
        <label className="inventory-filter"><span>Almacén</span><select value={selectedWarehouseId} onChange={(event) => changeWarehouse(event.target.value)}><option value="">Selecciona un almacén</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.isDispatchEnabled ? " · despacho activo" : " · solo resguardo"}</option>)}</select></label>
        <label className="inventory-filter"><span>Horizonte</span><select value={horizonDays} onChange={(event) => changeHorizon(event.target.value)}>{horizons.map((days) => <option key={days} value={days}>{days} días</option>)}</select></label>
        <div className="inventory-summary"><strong>{alerts.length.toString().padStart(2, "0")}</strong><span>alertas visibles</span></div>
      </section>

      {!warehouses.length ? <section className="inventory-empty panel"><span className="empty-symbol">✦</span><h2>No hay almacenes visibles.</h2><p>Tu sucursal todavía no tiene un almacén disponible para consultar.</p></section> : (
        <section className="inventory-layout">
          <article className="inventory-table-panel panel">
            <div className="panel-heading"><div><p className="section-kicker">Control FEFO</p><h2>Vencimientos y disponibilidad</h2></div><span className="panel-count">{alerts.length.toString().padStart(2, "0")}</span></div>
            {loadingAlerts ? <div className="inventory-state"><span className="loading-orb" />Actualizando alertas…</div> : alerts.length ? <div className="inventory-alert-list">
              <div className="inventory-table-head"><span>Lote</span><span>Vence</span><span>Estado</span><span>Disponibilidad</span><span>Acción</span></div>
              {alerts.map((alert) => <article className="inventory-alert-row" key={alert.batchId}>
                <div className="inventory-lot"><span className="lot-avatar">{alert.lotCode.slice(0, 1).toUpperCase()}</span><div><strong>{alert.lotCode}</strong><small>{alert.batchId.slice(0, 8)}…</small></div></div>
                <div className="inventory-date"><strong>{formatDate(alert.expiresOn)}</strong><small>{statusLabel(alert.status)}</small></div>
                <div><span className={`inventory-status status-${alert.batchStatus.toLowerCase()}`}>{batchStatusLabel(alert.batchStatus)}</span></div>
                <div className="inventory-quantity"><strong>{alert.availableQuantity}</strong><small>libres de {alert.quantityBase} · {alert.reservedBase} reservadas</small></div>
                <div className="inventory-actions">{alert.batchStatus === "AVAILABLE" ? <><button className="row-action" onClick={() => openAction("QUARANTINE", alert)} type="button">Cuarentenar</button><button className="row-action row-action-muted" onClick={() => openAction("WASTE", alert)} type="button">Merma</button></> : alert.batchStatus === "QUARANTINED" ? <button className="row-action" onClick={() => openAction("RELEASE", alert)} type="button">Liberar</button> : <span className="action-muted">Sin acciones</span>}</div>
              </article>)}
            </div> : <div className="inventory-state inventory-empty-inline"><span className="empty-symbol">✓</span><h3>Todo despejado por ahora.</h3><p>No hay lotes con vencimiento dentro de {horizonDays} días.</p></div>}
          </article>

          {action ? <aside className="inventory-action-panel panel"><div className="panel-heading"><div><p className="section-kicker">Acción operativa</p><h2>{actionLabel(action.kind)}</h2></div><button className="close-action" onClick={() => setAction(null)} type="button" aria-label="Cerrar acción">×</button></div><p className="action-context">Lote <strong>{action.alert.lotCode}</strong> · vence {formatDate(action.alert.expiresOn)}</p><form className="inventory-action-form" onSubmit={submitAction}>
            {action.kind === "QUARANTINE" ? <label className="field"><span>Motivo</span><select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as QuarantineReasonCode)}><option value="QUALITY">Calidad</option><option value="COLD_CHAIN">Cadena de frío</option><option value="DAMAGE">Daño físico</option><option value="OTHER">Otro</option></select></label> : null}
            {action.kind === "QUARANTINE" && reasonCode === "COLD_CHAIN" ? <label className="field"><span>Temperatura registrada (°C)</span><input required type="number" step="0.1" value={temperatureCelsius} onChange={(event) => setTemperatureCelsius(event.target.value)} placeholder="Ej. 8.5" /></label> : null}
            {action.kind === "WASTE" ? <label className="field"><span>Cantidad base</span><input min="1" required type="number" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} /></label> : null}
            <label className="field"><span>Detalle de la operación</span><textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Escribe el motivo para dejar trazabilidad." rows={4} /></label>
            <button className="primary-button" disabled={saving} type="submit">{saving ? "Aplicando…" : "Confirmar acción"}<span>↗</span></button>
          </form></aside> : <aside className="inventory-action-panel panel inventory-action-placeholder"><span className="empty-symbol">✦</span><h2>Selecciona una acción</h2><p>Las operaciones quedan auditadas y nunca modifican reservas por accidente.</p></aside>}
        </section>
      )}
    </main>
  );
}
