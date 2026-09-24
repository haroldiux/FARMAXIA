"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { currentSession, logout, type AuthSession } from "../lib/session";
import {
  confirmCashSale,
  listSalesProducts,
  listSalesShifts,
  listSalesWarehouses,
  type ConfirmedSale,
  type SalesPresentation,
  type SalesProduct,
  type SalesShift,
  type SalesWarehouse
} from "../lib/sales";

type DraftLine = { presentationId: string; quantity: string; unitPriceBob: string };

function decimal(value: string): boolean {
  return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(value.trim());
}

function shiftLabel(shift: SalesShift): string {
  return `${shift.cashRegisterCode} · ${new Date(shift.scheduledStartAt).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" })}`;
}

export default function SalesPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [shifts, setShifts] = useState<SalesShift[]>([]);
  const [warehouses, setWarehouses] = useState<SalesWarehouse[]>([]);
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [shiftId, setShiftId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ presentationId: "", quantity: "1", unitPriceBob: "" }]);
  const [paidAmountBob, setPaidAmountBob] = useState("");
  const [sale, setSale] = useState<ConfirmedSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([currentSession(), listSalesShifts(), listSalesWarehouses(), listSalesProducts()])
      .then(([value, loadedShifts, loadedWarehouses, loadedProducts]) => {
        if (!mounted) return;
        setSession(value);
        setShifts(loadedShifts);
        setWarehouses(loadedWarehouses);
        setProducts(loadedProducts);
        setShiftId(loadedShifts.find((item) => item.control?.status === "OPEN")?.id ?? "");
        setWarehouseId(loadedWarehouses.find((item) => item.isDispatchEnabled)?.id ?? "");
      })
      .catch((reason) => {
        if (mounted) setError(reason instanceof Error ? reason.message : "No pudimos cargar el espacio de ventas.");
      })
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const openShifts = useMemo(() => shifts.filter((item) => item.control?.status === "OPEN"), [shifts]);
  const dispatchWarehouses = useMemo(() => warehouses.filter((item) => item.isDispatchEnabled), [warehouses]);
  const sellablePresentations = useMemo(() => products.flatMap((product) => product.presentations
    .filter((presentation) => presentation.isSellable)
    .map((presentation) => ({
      ...presentation,
      label: `${product.name} · ${presentation.name}`
    }))), [products]);
  const missingRequirements = useMemo(() => [
    openShifts.length ? null : "un turno abierto",
    dispatchWarehouses.length ? null : "un almacén de despacho",
    sellablePresentations.length ? null : "una presentación vendible"
  ].filter((requirement): requirement is string => requirement !== null), [dispatchWarehouses, openShifts, sellablePresentations]);

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSale(null);
    const openShift = shifts.find((item) => item.id === shiftId)?.control?.status === "OPEN";
    if (!openShift || !warehouseId || !lines.length || lines.some((line) => !line.presentationId || !Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) < 1 || !decimal(line.unitPriceBob)) || !decimal(paidAmountBob)) {
      setError("Selecciona un turno abierto, un almacén, productos y montos decimales válidos.");
      return;
    }
    setSaving(true);
    try {
      const result = await confirmCashSale({
        cashShiftId: shiftId,
        warehouseId,
        paidAmountBob: paidAmountBob.trim(),
        lines: lines.map((line) => ({ presentationId: line.presentationId, quantity: Number(line.quantity), unitPriceBob: line.unitPriceBob.trim() }))
      });
      setSale(result);
      setLines([{ presentationId: "", quantity: "1", unitPriceBob: "" }]);
      setPaidAmountBob("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos confirmar la venta.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut(): Promise<void> { await logout(); window.location.assign("/"); }

  const workspaceHeader = <header className="cash-header"><div><Link className="back-link" href="/dashboard">← Volver al resumen</Link><p className="eyebrow">F11 · Ventas POS</p><h1>Confirma la venta sin perder el hilo.</h1><p className="cash-lede">Venta no fiscal, pago en efectivo y consumo FEFO. El total siempre lo confirma el servidor.</p></div><button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button></header>;

  if (loading) return <main className="center-state"><span className="loading-orb" />Cargando ventas…</main>;
  if (!session) return <main className="center-state"><div><strong>No pudimos validar tu sesión.</strong><Link href="/">Volver al ingreso</Link></div></main>;
  if (!session.permissions.includes("sales.confirm")) return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para confirmar ventas.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  if (missingRequirements.length) return <main className="cash-page">
    {workspaceHeader}
    {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
    <section className="panel cash-shifts-panel" aria-live="polite">
      <p className="section-kicker">Espacio de ventas incompleto</p>
      <h2>Completa estos requisitos antes de vender</h2>
      <p>Tu sesión está activa, pero todavía falta:</p>
      <ul>{missingRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
      <Link className="quiet-button" href="/dashboard">Volver al resumen</Link>
    </section>
  </main>;

  return <main className="cash-page">
    {workspaceHeader}
    {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
    {sale ? <section className="panel cash-shifts-panel" aria-live="polite"><p className="section-kicker">Venta confirmada</p><h2>{sale.totalBob} BOB</h2><p>Pago CASH · {sale.paidAmountBob} BOB · FEFO aplicado a {sale.items.length} línea(s).</p><button className="quiet-button" type="button" onClick={() => setSale(null)}>Nueva venta</button></section> : <form className="panel cash-shifts-panel" onSubmit={submit}>
      <div className="panel-heading"><div><p className="section-kicker">Confirmación</p><h2>Venta en efectivo</h2></div></div>
      <label className="inventory-filter"><span>Turno abierto</span><select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="">Selecciona un turno abierto</option>{openShifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>)}</select></label>
      <label className="inventory-filter"><span>Almacén de despacho</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Selecciona un almacén</option>{dispatchWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      {lines.map((line, index) => <div className="cash-shift-card" key={`${index}-${line.presentationId}`}><label className="inventory-filter"><span>Producto</span><select value={line.presentationId} onChange={(event) => updateLine(index, { presentationId: event.target.value })}><option value="">Selecciona presentación</option>{sellablePresentations.map((presentation: SalesPresentation & { label: string }) => <option key={presentation.presentationId} value={presentation.presentationId}>{presentation.label}</option>)}</select></label><label className="inventory-filter"><span>Cantidad</span><input inputMode="numeric" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label><label className="inventory-filter"><span>Precio unitario BOB</span><input inputMode="decimal" value={line.unitPriceBob} onChange={(event) => updateLine(index, { unitPriceBob: event.target.value })} /></label></div>)}
      <button className="quiet-button" type="button" onClick={() => setLines((current) => [...current, { presentationId: "", quantity: "1", unitPriceBob: "" }])}>Agregar línea</button>
      <label className="inventory-filter"><span>Total pagado BOB</span><input required inputMode="decimal" value={paidAmountBob} onChange={(event) => setPaidAmountBob(event.target.value)} /></label>
      <button className="primary-button" disabled={saving} type="submit">{saving ? "Confirmando…" : "Confirmar venta CASH"}</button>
    </form>}
  </main>;
}
