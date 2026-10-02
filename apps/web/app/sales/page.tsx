"use client";

import Link from "next/link";
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SalesNav } from "../components/sales-nav";
import {
  addToCart,
  cartTotalUnits,
  decrementLine,
  fromUnits,
  incrementLine,
  isCartSellable,
  isDecimal,
  lineTotalUnits,
  looksLikeBarcode,
  parseQuantityInput,
  removeLine,
  setLineBatch,
  setQuantity,
  toUnits,
  type CartLine,
  type CartResult
} from "../lib/pos-cart";
import { currentSession, type AuthSession } from "../lib/session";
import {
  confirmSale,
  getQuote,
  salePaymentMethodLabels,
  listSalesShifts,
  listSalesBatches,
  listSalesWarehouses,
  lookupSalesPresentations,
  SalesApiError,
  type ConfirmedSale,
  type QuoteDetail,
  type SalePaymentMethod,
  type SalesBatchOption,
  type SalesLookupItem,
  type SalesShift,
  type SalesWarehouse
} from "../lib/sales";

type DraftPayment = { method: SalePaymentMethod; amountBob: string; reference: string };

const emptyPayment = (): DraftPayment => ({ method: "CASH", amountBob: "", reference: "" });
const SEARCH_DEBOUNCE_MS = 250;

function shiftLabel(shift: SalesShift): string {
  return `${shift.cashRegisterCode} · ${new Date(shift.scheduledStartAt).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" })}`;
}

const overrideErrorMessages: Record<string, string> = {
  FEFO_OVERRIDE_FORBIDDEN: "Tu usuario no puede elegir un lote distinto al FEFO.",
  FEFO_BATCH_NOT_FOUND: "El lote elegido ya no tiene stock en este almacén. Elige otro lote.",
  FEFO_BATCH_MISMATCH: "El lote elegido pertenece a otro producto. Elige otro lote.",
  FEFO_BATCH_UNAVAILABLE: "El lote elegido está en cuarentena o vencido. Elige otro lote.",
  FEFO_BATCH_INSUFFICIENT: "El lote elegido no tiene stock suficiente para la cantidad. Reduce la cantidad o elige otro lote."
};

function batchOptionLabel(option: SalesBatchOption): string {
  return `${option.lotCode} · vence ${option.expiresOn}`;
}

function itemLabel(item: SalesLookupItem): string {
  return `${item.productName} · ${item.presentationName}`;
}

export default function SalesPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [shifts, setShifts] = useState<SalesShift[]>([]);
  const [warehouses, setWarehouses] = useState<SalesWarehouse[]>([]);
  const [shiftId, setShiftId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([emptyPayment()]);
  const [sale, setSale] = useState<ConfirmedSale | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SalesLookupItem[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const quoteLoaded = useRef(false);
  const [lotPicker, setLotPicker] = useState<{ presentationId: string; options: SalesBatchOption[]; loading: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const actions = useRef<{ submit: () => void; clearSearch: () => boolean }>({ submit: () => undefined, clearSearch: () => false });

  useEffect(() => {
    let mounted = true;
    Promise.all([currentSession(), listSalesShifts(), listSalesWarehouses()])
      .then(([value, loadedShifts, loadedWarehouses]) => {
        if (!mounted) return;
        setSession(value);
        setShifts(loadedShifts);
        setWarehouses(loadedWarehouses);
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
  const missingRequirements = useMemo(() => [
    openShifts.length ? null : "un turno abierto",
    dispatchWarehouses.length ? null : "un almacén de despacho"
  ].filter((requirement): requirement is string => requirement !== null), [dispatchWarehouses, openShifts]);

  const canOverrideFefo = session?.permissions.includes("sales.fefo.override") ?? false;
  const hasOverride = cart.some((line) => line.batchId !== undefined);
  const estimatedUnits = cartTotalUnits(cart);
  const validPayments = payments.filter((payment) => isDecimal(payment.amountBob));
  const paidUnits = validPayments.reduce((sum, payment) => sum + toUnits(payment.amountBob), 0n);
  const cardQrUnits = validPayments
    .filter((payment) => payment.method !== "CASH")
    .reduce((sum, payment) => sum + toUnits(payment.amountBob), 0n);
  const remainingUnits = estimatedUnits > paidUnits ? estimatedUnits - paidUnits : 0n;
  const changeUnits = paidUnits > estimatedUnits ? paidUnits - estimatedUnits : 0n;
  const searchReady = !loading && session !== null && missingRequirements.length === 0;

  // "Convertir en venta" opens /sales?quoteId=...: preload the cart with the quote lines at today's prices and stock.
  useEffect(() => {
    if (!searchReady || !warehouseId || quoteLoaded.current) return;
    const quoteId = new URLSearchParams(window.location.search).get("quoteId");
    if (!quoteId) return;
    quoteLoaded.current = true;
    (async () => {
      try {
        const loaded = await getQuote(quoteId);
        if (loaded.status !== "OPEN") {
          setError(`La proforma ${loaded.number} ya no está vigente (${loaded.status === "EXPIRED" ? "venció" : loaded.status === "CONVERTED" ? "ya se convirtió en venta" : "fue anulada"}).`);
          return;
        }
        let lines: CartLine[] = [];
        const skipped: string[] = [];
        for (const item of loaded.items) {
          const label = `${item.productName} · ${item.presentationName}`;
          const found = (await lookupSalesPresentations(item.productName, warehouseId)).find((entry) => entry.presentationId === item.presentationId);
          const added = found ? addToCart(lines, { presentationId: found.presentationId, label, priceBob: found.priceBob, availableQuantity: found.availableQuantity }) : null;
          if (!added || added.lines.length === lines.length) {
            skipped.push(label);
            continue;
          }
          lines = setQuantity(added.lines, item.presentationId, item.quantity).lines;
        }
        setCart(lines);
        setQuote(loaded);
        const messages: string[] = [];
        if (loaded.pricesChanged) messages.push("Los precios cambiaron desde la proforma: revisa el total antes de cobrar.");
        if (skipped.length) messages.push(`Sin precio o sin stock en este almacén, no se cargó: ${skipped.join(", ")}.`);
        if (lines.some((line) => loaded.items.find((item) => item.presentationId === line.presentationId && item.quantity > line.quantity))) messages.push("Algunas cantidades se ajustaron al stock disponible.");
        setNotice(messages.length ? messages.join(" ") : null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No pudimos cargar la proforma.");
      }
    })();
  }, [searchReady, warehouseId]);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  const applyCart = useCallback((result: CartResult) => {
    setCart(result.lines);
    setNotice(result.warning);
  }, []);

  const resetSearch = useCallback(() => {
    searchSeq.current += 1;
    setQuery("");
    setResults([]);
    setHighlight(0);
    setSearching(false);
  }, []);

  const addItem = useCallback((item: SalesLookupItem, current: CartLine[]) => {
    setError(null);
    setSale(null);
    applyCart(addToCart(current, {
      presentationId: item.presentationId,
      label: itemLabel(item),
      priceBob: item.priceBob,
      availableQuantity: item.availableQuantity
    }));
    resetSearch();
    focusSearch();
  }, [applyCart, focusSearch, resetSearch]);

  // Debounced text search; the sequence counter drops answers that arrive after a newer keystroke or a clear.
  useEffect(() => {
    const text = query.trim();
    if (!searchReady || !warehouseId || text === "") {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      lookupSalesPresentations(text, warehouseId, controller.signal)
        .then((items) => {
          if (seq !== searchSeq.current) return;
          setResults(items);
          setHighlight(0);
          setSearching(false);
        })
        .catch((reason) => {
          if (seq !== searchSeq.current || controller.signal.aborted) return;
          setSearching(false);
          setError(reason instanceof Error ? reason.message : "No pudimos buscar productos.");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchReady, warehouseId]);

  async function submitSearch(): Promise<void> {
    const text = query.trim();
    if (!text || !warehouseId) return;
    setError(null);
    try {
      if (looksLikeBarcode(text)) {
        // Scanner path: resolve the exact code right away instead of waiting for the debounce.
        const items = await lookupSalesPresentations(text, warehouseId);
        const match = items.find((item) => item.barcode === text);
        if (match) {
          addItem(match, cart);
        } else {
          resetSearch();
          setError(`El código de barras ${text} no está registrado.`);
          focusSearch();
        }
        return;
      }
      const picked = results[highlight] ?? (await lookupSalesPresentations(text, warehouseId))[0];
      if (picked) addItem(picked, cart);
      else setError(`No encontramos productos para "${text}".`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos buscar productos.");
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setHighlight((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setHighlight((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void submitSearch();
    }
  }

  function updatePayment(index: number, patch: Partial<DraftPayment>): void {
    setPayments((current) => current.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, ...patch } : payment));
  }

  async function toggleLotPicker(line: CartLine): Promise<void> {
    if (lotPicker?.presentationId === line.presentationId) {
      setLotPicker(null);
      return;
    }
    setError(null);
    setLotPicker({ presentationId: line.presentationId, options: [], loading: true });
    try {
      const options = await listSalesBatches(line.presentationId, warehouseId);
      setLotPicker((current) => current?.presentationId === line.presentationId ? { presentationId: line.presentationId, options, loading: false } : current);
    } catch (reason) {
      setLotPicker(null);
      setError(reason instanceof Error ? reason.message : "No pudimos cargar los lotes.");
    }
  }

  function chooseLot(line: CartLine, option: SalesBatchOption): void {
    // Picking the FEFO suggestion is the normal flow: no override and no reason needed.
    const next = setLineBatch(cart, line.presentationId, option.fefoSuggested ? null : { batchId: option.batchId, label: batchOptionLabel(option) });
    setCart(next);
    if (!next.some((item) => item.batchId !== undefined)) setOverrideReason("");
    setLotPicker(null);
  }

  function changeWarehouse(value: string): void {
    setWarehouseId(value);
    setLotPicker(null);
    setOverrideReason("");
    // Availability belongs to the warehouse, so a cart built against another one is no longer reliable.
    setNotice(cart.length ? "Cambiaste de almacén: el carrito se vació porque el stock es distinto." : null);
    setCart([]);
    resetSearch();
  }

  async function submitSale(): Promise<void> {
    if (saving) return;
    setError(null);
    setSale(null);
    const openShift = shifts.find((item) => item.id === shiftId)?.control?.status === "OPEN";
    if (!openShift || !warehouseId || !isCartSellable(cart) || !payments.length || payments.some((payment) => !isDecimal(payment.amountBob) || toUnits(payment.amountBob) <= 0n)) {
      setError("Selecciona un turno abierto, un almacén, productos con stock y montos decimales válidos.");
      return;
    }
    if (payments.some((payment) => payment.method !== "CASH" && !payment.reference.trim())) {
      setError("Los pagos con tarjeta o QR requieren una referencia.");
      return;
    }
    if (remainingUnits > 0n) {
      setError("Los pagos no cubren el total de la venta.");
      return;
    }
    if (cardQrUnits > estimatedUnits) {
      setError("Los pagos con tarjeta o QR no pueden superar el monto por cobrar.");
      return;
    }
    if (hasOverride && (!overrideReason.trim() || overrideReason.trim().length > 200)) {
      setError("Escribe el motivo del cambio de lote (hasta 200 caracteres).");
      return;
    }
    setSaving(true);
    try {
      const result = await confirmSale({
        cashShiftId: shiftId,
        warehouseId,
        payments: payments.map((payment) => ({
          method: payment.method,
          amountBob: payment.amountBob.trim(),
          ...(payment.method === "CASH" ? {} : { reference: payment.reference.trim() })
        })),
        lines: cart.map((line) => ({
          presentationId: line.presentationId,
          quantity: line.quantity,
          unitPriceBob: line.unitPriceBob,
          ...(line.batchId ? { batchId: line.batchId } : {})
        })),
        ...(hasOverride ? { overrideReason: overrideReason.trim() } : {}),
        ...(quote ? { quoteId: quote.id } : {})
      });
      setSale(result);
      if (quote) {
        setQuote(null);
        window.history.replaceState(null, "", "/sales");
      }
      setCart([]);
      setOverrideReason("");
      setLotPicker(null);
      setNotice(null);
      setPayments([emptyPayment()]);
      resetSearch();
      focusSearch();
    } catch (reason) {
      if (reason instanceof SalesApiError && reason.code === "PRICE_CHANGED" && reason.currentPriceBob && isDecimal(reason.currentPriceBob)) {
        const { presentationId, currentPriceBob } = reason;
        setCart((current) => current.map((line) => line.presentationId === presentationId ? { ...line, unitPriceBob: currentPriceBob } : line));
        setError("El precio de un producto cambió. Actualizamos el carrito con el precio vigente: revisa el total y confirma de nuevo.");
      } else if (reason instanceof SalesApiError && reason.code === "PRICE_NOT_FOUND") {
        setError("Un producto del carrito ya no tiene precio vigente. Quítalo o pide que le asignen un precio.");
      } else if (reason instanceof SalesApiError && reason.code === "QUOTE_NOT_OPEN") {
        setError("La proforma ya no está vigente (se convirtió, se anuló o venció). Quita la proforma del cobro o crea una nueva.");
      } else if (reason instanceof SalesApiError && reason.code && overrideErrorMessages[reason.code]) {
        setError(overrideErrorMessages[reason.code]!);
      } else {
        setError(reason instanceof Error ? reason.message : "No pudimos confirmar la venta.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Shortcuts call the latest closures through a ref so the listener is registered once.
  actions.current = {
    submit: () => void submitSale(),
    clearSearch: () => {
      if (!query && !results.length) return false;
      resetSearch();
      return true;
    }
  };

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "F2") {
        event.preventDefault();
        focusSearch();
      } else if (event.key === "F4") {
        event.preventDefault();
        paymentRef.current?.focus();
        paymentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (event.key === "F9") {
        event.preventDefault();
        actions.current.submit();
      } else if (event.key === "Escape") {
        if (actions.current.clearSearch()) event.preventDefault();
        focusSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  const workspaceHeader = <><header className="cash-header"><div><p className="eyebrow">F11 · Ventas POS</p><h1>Cobra rápido, sin perder el hilo.</h1><p className="cash-lede">Escanea o busca el producto, revisa el carrito y cobra en efectivo, tarjeta o QR (también combinados). Venta no fiscal con consumo FEFO; el total final lo confirma el servidor.</p></div></header><SalesNav /></>;

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

  return <main className="cash-page pos-page">
    {workspaceHeader}
    {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
    {quote ? <p className="pos-notice quote-banner" role="status">Cobrando la proforma <strong>{quote.number}</strong>{quote.customerName ? ` de ${quote.customerName}` : ""}. Puedes editar las líneas; el precio es siempre el vigente. <button className="quiet-button" type="button" onClick={() => { setQuote(null); setCart([]); setNotice(null); window.history.replaceState(null, "", "/sales"); }}>Descartar proforma</button></p> : null}
    {sale ? <section className="panel cash-shifts-panel sale-confirmed" aria-live="polite"><p className="section-kicker">Venta confirmada</p><h2>{sale.totalBob} BOB</h2><p>{sale.payments.map((payment) => `${salePaymentMethodLabels[payment.method]} ${payment.amountBob}${payment.reference ? ` (${payment.reference})` : ""}`).join(" · ")} · Cambio {sale.changeAmountBob} BOB · FEFO aplicado a {sale.items.length} línea(s).</p><p>Número de venta: <strong>{sale.saleNumber}</strong></p><div className="user-actions"><Link className="primary-button receipt-link" href={`/sales/${sale.id}`}>Ver / imprimir recibo</Link><button className="quiet-button pos-touch" type="button" onClick={() => { setSale(null); focusSearch(); }}>Siguiente cliente</button></div></section> : null}
    <form className="cash-layout sales-layout" onSubmit={(event) => { event.preventDefault(); void submitSale(); }}>
      <section className="panel cash-shifts-panel">
        <div className="panel-heading"><div><p className="section-kicker">Venta del mostrador</p><h2>Buscar y agregar productos</h2></div><span className="panel-count">{cart.length.toString().padStart(2, "0")}</span></div>
        <div className="pos-selectors">
          <label className="inventory-filter"><span>Turno abierto</span><select value={shiftId} onChange={(event) => setShiftId(event.target.value)}><option value="">Selecciona un turno abierto</option>{openShifts.map((shift) => <option key={shift.id} value={shift.id}>{shiftLabel(shift)}</option>)}</select></label>
          <label className="inventory-filter"><span>Almacén de despacho</span><select value={warehouseId} onChange={(event) => changeWarehouse(event.target.value)}><option value="">Selecciona un almacén</option>{dispatchWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
        </div>
        <div className="pos-search">
          <label className="inventory-filter"><span>Producto o código de barras</span>
            <input ref={searchRef} autoFocus autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls="pos-results" aria-autocomplete="list" placeholder="Nombre, DCI, principio activo, laboratorio o escanea el código" value={query} disabled={!warehouseId} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} />
          </label>
          {searching ? <p className="pos-hint" aria-live="polite">Buscando…</p> : null}
          {query.trim() && !searching && !results.length ? <p className="pos-hint">Sin resultados. Presiona Enter para reintentar o Esc para limpiar.</p> : null}
          {results.length ? <ul className="pos-results" id="pos-results" role="listbox">{results.map((item, index) => {
            const blocked = item.priceBob === null || item.availableQuantity < 1;
            return <li key={item.presentationId} role="option" aria-selected={index === highlight}>
              <button type="button" className={`pos-result${index === highlight ? " is-active" : ""}`} onMouseEnter={() => setHighlight(index)} onClick={() => addItem(item, cart)}>
                <span className="pos-result-main"><strong>{item.productName}</strong><small>{item.presentationName}{item.genericName ? ` · ${item.genericName}` : ""}{item.laboratory ? ` · ${item.laboratory}` : ""}</small></span>
                <span className="pos-result-side"><strong>{item.priceBob === null ? "Sin precio" : `${item.priceBob} BOB`}</strong><small className={blocked ? "pos-low" : ""}>{item.availableQuantity < 1 ? "Sin stock" : `Stock: ${item.availableQuantity}`}</small></span>
              </button>
            </li>;
          })}</ul> : null}
        </div>
        {notice ? <p className="pos-notice" role="status">{notice}</p> : null}
        {cart.length ? <ul className="pos-cart" aria-label="Carrito">{cart.map((line) => <li className="pos-cart-line" key={line.presentationId}>
          <div className="pos-cart-name"><strong>{line.label}</strong><small>{line.unitPriceBob} BOB c/u · disponibles: {line.available}</small>{line.batchLabel ? <small className="pos-lot-chosen">Lote elegido: {line.batchLabel}</small> : null}</div>
          <div className="pos-qty" role="group" aria-label={`Cantidad de ${line.label}`}>
            <button className="quiet-button pos-touch" type="button" aria-label="Quitar una unidad" disabled={line.quantity <= 1} onClick={() => applyCart(decrementLine(cart, line.presentationId))}>−</button>
            <input className="pos-qty-input" inputMode="numeric" aria-label="Cantidad" value={line.quantity === 0 ? "" : line.quantity} onChange={(event) => applyCart(setQuantity(cart, line.presentationId, parseQuantityInput(event.target.value)))} onBlur={() => { if (line.quantity === 0) applyCart(setQuantity(cart, line.presentationId, 1)); }} onFocus={(event) => event.target.select()} />
            <button className="quiet-button pos-touch" type="button" aria-label="Agregar una unidad" disabled={line.quantity >= line.available} onClick={() => applyCart(incrementLine(cart, line.presentationId))}>+</button>
          </div>
          <strong className="pos-line-total">{fromUnits(lineTotalUnits(line))} BOB</strong>
          <button className="quiet-button pos-touch pos-remove" type="button" aria-label={`Quitar ${line.label}`} onClick={() => { setCart(removeLine(cart, line.presentationId)); setNotice(null); if (lotPicker?.presentationId === line.presentationId) setLotPicker(null); focusSearch(); }}>Quitar</button>
          {canOverrideFefo ? <div className="pos-lot-row">
            <button className="quiet-button pos-touch" type="button" aria-expanded={lotPicker?.presentationId === line.presentationId} onClick={() => void toggleLotPicker(line)}>Cambiar lote</button>
            {lotPicker?.presentationId === line.presentationId ? (lotPicker.loading ? <small className="pos-hint">Cargando lotes…</small> : lotPicker.options.length ? <ul className="pos-lot-list" aria-label={`Lotes de ${line.label}`}>{lotPicker.options.map((option) => <li key={option.batchId}>
              <button type="button" className={`pos-lot-option${(line.batchId ?? lotPicker.options.find((item) => item.fefoSuggested)?.batchId) === option.batchId ? " is-active" : ""}`} onClick={() => chooseLot(line, option)}>
                <strong>{option.lotCode}</strong><span>vence {option.expiresOn} · {option.availableBase} u. base</span>{option.fefoSuggested ? <em className="pos-lot-badge">FEFO sugerido</em> : null}
              </button>
            </li>)}</ul> : <small className="pos-hint">No hay lotes disponibles en este almacén.</small>) : null}
          </div> : null}
        </li>)}</ul> : <p className="pos-empty">El carrito está vacío. Escanea un producto o búscalo para empezar.</p>}
        {hasOverride ? <label className="inventory-filter pos-override-reason"><span>Motivo del cambio de lote (obligatorio)</span><input required maxLength={200} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Ej.: el cliente pidió el lote de mayor vencimiento" /></label> : null}
        <p className="pos-shortcuts" aria-label="Atajos de teclado"><kbd>F2</kbd> Buscar · <kbd>↑</kbd><kbd>↓</kbd> + <kbd>Enter</kbd> Elegir · <kbd>F4</kbd> Cobro · <kbd>F9</kbd> Confirmar · <kbd>Esc</kbd> Limpiar</p>
      </section>
      <aside className="panel cash-form-panel sales-summary">
        <div className="panel-heading"><div><p className="section-kicker">Cobro</p><h2>Confirmación</h2></div></div>
        <div className="sales-estimate"><span>Total</span><strong>{fromUnits(estimatedUnits)} BOB</strong><small>Según los precios vigentes de la sucursal. El total final lo calcula el servidor.</small></div>
        {payments.map((payment, index) => <div className="cash-shift-card" key={index}>
          <label className="inventory-filter"><span>Método de pago</span><select className="pos-touch" value={payment.method} onChange={(event) => updatePayment(index, { method: event.target.value as SalePaymentMethod, reference: "" })}>{(Object.keys(salePaymentMethodLabels) as SalePaymentMethod[]).map((method) => <option key={method} value={method}>{salePaymentMethodLabels[method]}</option>)}</select></label>
          <label className="inventory-filter"><span>Monto BOB</span><input ref={index === 0 ? paymentRef : undefined} className="pos-touch" required inputMode="decimal" value={payment.amountBob} onChange={(event) => updatePayment(index, { amountBob: event.target.value })} /></label>
          {payment.method === "CASH" ? null : <label className="inventory-filter"><span>Referencia ({salePaymentMethodLabels[payment.method]})</span><input className="pos-touch" required maxLength={64} value={payment.reference} onChange={(event) => updatePayment(index, { reference: event.target.value })} /></label>}
          <div className="pos-payment-actions">
            <button className="quiet-button pos-touch" type="button" disabled={remainingUnits <= 0n} onClick={() => updatePayment(index, { amountBob: fromUnits((isDecimal(payment.amountBob) ? toUnits(payment.amountBob) : 0n) + remainingUnits) })}>Monto exacto</button>
            {payments.length > 1 ? <button className="quiet-button pos-touch" type="button" onClick={() => setPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index))}>Quitar pago</button> : null}
          </div>
        </div>)}
        <button className="quiet-button pos-touch" type="button" onClick={() => setPayments((current) => [...current, emptyPayment()])}>Agregar pago</button>
        <div className="sales-estimate" aria-live="polite"><span>Pagado</span><strong>{fromUnits(paidUnits)} BOB</strong><small>Falta: {fromUnits(remainingUnits)} BOB · Cambio: {fromUnits(changeUnits)} BOB</small></div>
        <button className="primary-button pos-confirm" disabled={saving || !cart.length} type="submit">{saving ? "Confirmando…" : "Confirmar venta (F9)"}</button>
      </aside>
    </form>
  </main>;
}
