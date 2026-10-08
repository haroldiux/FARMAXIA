"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { SalesNav } from "../../components/sales-nav";
import {
  addToCart,
  cartTotalUnits,
  decrementLine,
  fromUnits,
  incrementLine,
  lineTotalUnits,
  parseQuantityInput,
  removeLine,
  setQuantity,
  type CartLine,
  type CartResult
} from "../../lib/pos-cart";
import { currentSession, type AuthSession } from "../../lib/session";
import {
  createQuote,
  listQuotes,
  listSalesWarehouses,
  lookupSalesPresentations,
  quoteStatusLabels,
  SalesApiError,
  type QuoteList,
  type QuoteStatus,
  type SalesLookupItem,
  type SalesWarehouse
} from "../../lib/sales";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;
/** Quotes reserve no stock, so the stock-based cart limit is lifted for them. */
const NO_STOCK_LIMIT = 9999;

function money(value: string): string {
  return `Bs ${Number(value).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-BO", { dateStyle: "medium", timeStyle: "short" });
}

/** Proformas: listado con filtros y formulario para crear una nueva (sin reservar stock ni tocar caja). */
export default function QuotesPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [warehouses, setWarehouses] = useState<SalesWarehouse[]>([]);
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<QuoteList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [validDays, setValidDays] = useState("7");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SalesLookupItem[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  const canUse = Boolean(session?.permissions.includes("sales.confirm"));

  useEffect(() => {
    currentSession().then(setSession).catch(() => window.location.assign("/"));
    listSalesWarehouses()
      .then((items) => {
        setWarehouses(items);
        setWarehouseId(items.find((item) => item.isDispatchEnabled)?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listQuotes({ status, from, to, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar las proformas.");
    }
  }, [status, from, to, page]);

  useEffect(() => {
    if (canUse) void load();
  }, [canUse, load]);

  // Debounced search (same lookup as the POS); late answers are dropped through the sequence counter.
  useEffect(() => {
    const text = query.trim();
    if (!creating || !warehouseId || text === "") {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      lookupSalesPresentations(text, warehouseId, controller.signal)
        .then((items) => {
          if (seq !== searchSeq.current) return;
          setResults(items);
          setHighlight(0);
        })
        .catch((reason) => {
          if (seq === searchSeq.current && !controller.signal.aborted) {
            setError(reason instanceof Error ? reason.message : "No pudimos buscar productos.");
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, creating, warehouseId]);

  function applyCart(result: CartResult): void {
    setCart(result.lines);
    setNotice(result.warning);
  }

  function addItem(item: SalesLookupItem): void {
    setError(null);
    applyCart(addToCart(cart, { presentationId: item.presentationId, label: `${item.productName} · ${item.presentationName}`, priceBob: item.priceBob, availableQuantity: NO_STOCK_LIMIT }));
    searchSeq.current += 1;
    setQuery("");
    setResults([]);
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
      const picked = results[highlight];
      if (picked) addItem(picked);
    }
  }

  async function submitQuote(): Promise<void> {
    if (saving || !cart.length) return;
    const days = Number(validDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      setError("La vigencia debe ser un número entero de días entre 1 y 30.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const quote = await createQuote({
        lines: cart.map((line) => ({ presentationId: line.presentationId, quantity: line.quantity })),
        validDays: days,
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {})
      });
      router.push(`/sales/quotes/${quote.id}`);
    } catch (reason) {
      if (reason instanceof SalesApiError && reason.code === "PRICE_NOT_FOUND") {
        setError("Un producto del carrito no tiene precio vigente. Quítalo o pide que le asignen un precio.");
      } else {
        setError(reason instanceof Error ? reason.message : "No pudimos crear la proforma.");
      }
    } finally {
      setSaving(false);
    }
  }

  function changeFilter(apply: () => void): void {
    apply();
    setPage(0);
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!canUse) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para gestionar proformas.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const dispatchWarehouses = warehouses.filter((item) => item.isDispatchEnabled);

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <p className="eyebrow">Ventas · Proformas</p>
          <h1>Cotiza hoy, vende cuando el cliente decida.</h1>
          <p className="cash-lede">Una proforma no reserva stock, no mueve caja y no es una factura. Vale 7 días por defecto; al convertirla en venta se cobra siempre con el precio vigente.</p>
        </div>
      </header>
      <SalesNav />
      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}

      <section className="panel">
        <div className="panel-heading">
          <div><p className="section-kicker">Nueva proforma</p><h2>{creating ? "Arma la cotización" : "Crear una proforma"}</h2></div>
          <button className="quiet-button pos-touch" type="button" onClick={() => setCreating((current) => !current)}>{creating ? "Cerrar" : "Nueva proforma"}</button>
        </div>
        {creating ? (
          <form className="quote-form" onSubmit={(event) => { event.preventDefault(); void submitQuote(); }}>
            <div className="pos-selectors">
              <label className="inventory-filter"><span>Almacén para buscar</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setResults([]); }}><option value="">Selecciona un almacén</option>{dispatchWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
              <label className="inventory-filter"><span>Cliente (opcional)</span><input maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" /></label>
              <label className="inventory-filter"><span>Vigencia (días)</span><input inputMode="numeric" value={validDays} onChange={(event) => setValidDays(event.target.value.replace(/\D/g, "").slice(0, 2))} /></label>
            </div>
            <div className="pos-search">
              <label className="inventory-filter"><span>Producto</span>
                <input autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls="quote-results" aria-autocomplete="list" placeholder="Nombre, DCI, principio activo o código de barras" value={query} disabled={!warehouseId} onChange={(event) => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} />
              </label>
              {results.length ? <ul className="pos-results" id="quote-results" role="listbox">{results.map((item, index) => (
                <li key={item.presentationId} role="option" aria-selected={index === highlight}>
                  <button type="button" className={`pos-result${index === highlight ? " is-active" : ""}`} onMouseEnter={() => setHighlight(index)} onClick={() => addItem(item)}>
                    <span className="pos-result-main"><strong>{item.productName}</strong><small>{item.presentationName}{item.genericName ? ` · ${item.genericName}` : ""}</small></span>
                    <span className="pos-result-side"><strong>{item.priceBob === null ? "Sin precio" : `${item.priceBob} BOB`}</strong></span>
                  </button>
                </li>
              ))}</ul> : null}
            </div>
            {notice ? <p className="pos-notice" role="status">{notice}</p> : null}
            {cart.length ? <ul className="pos-cart" aria-label="Líneas de la proforma">{cart.map((line) => (
              <li className="pos-cart-line" key={line.presentationId}>
                <div className="pos-cart-name"><strong>{line.label}</strong><small>{line.unitPriceBob} BOB c/u</small></div>
                <div className="pos-qty" role="group" aria-label={`Cantidad de ${line.label}`}>
                  <button className="quiet-button pos-touch" type="button" aria-label="Quitar una unidad" disabled={line.quantity <= 1} onClick={() => applyCart(decrementLine(cart, line.presentationId))}>−</button>
                  <input className="pos-qty-input" inputMode="numeric" aria-label="Cantidad" value={line.quantity === 0 ? "" : line.quantity} onChange={(event) => applyCart(setQuantity(cart, line.presentationId, parseQuantityInput(event.target.value)))} onBlur={() => { if (line.quantity === 0) applyCart(setQuantity(cart, line.presentationId, 1)); }} onFocus={(event) => event.target.select()} />
                  <button className="quiet-button pos-touch" type="button" aria-label="Agregar una unidad" onClick={() => applyCart(incrementLine(cart, line.presentationId))}>+</button>
                </div>
                <strong className="pos-line-total">{fromUnits(lineTotalUnits(line))} BOB</strong>
                <button className="quiet-button pos-touch pos-remove" type="button" aria-label={`Quitar ${line.label}`} onClick={() => setCart(removeLine(cart, line.presentationId))}>Quitar</button>
              </li>
            ))}</ul> : <p className="pos-empty">Agrega al menos un producto para crear la proforma.</p>}
            <label className="inventory-filter"><span>Nota para el cliente (opcional)</span><input maxLength={500} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} placeholder="Ej.: precios sujetos a stock" /></label>
            <div className="sales-estimate"><span>Total estimado</span><strong>{fromUnits(cartTotalUnits(cart))} BOB</strong><small>El servidor fija los precios vigentes al crear la proforma.</small></div>
            <button className="primary-button pos-confirm" disabled={saving || !cart.length} type="submit">{saving ? "Creando…" : "Crear proforma"}</button>
          </form>
        ) : null}
      </section>

      <section className="panel sales-filters" aria-label="Filtros">
        <label className="inventory-filter"><span>Desde</span><input type="date" value={from} onChange={(event) => changeFilter(() => setFrom(event.target.value))} /></label>
        <label className="inventory-filter"><span>Hasta</span><input type="date" value={to} onChange={(event) => changeFilter(() => setTo(event.target.value))} /></label>
        <label className="inventory-filter"><span>Estado</span>
          <select value={status} onChange={(event) => changeFilter(() => setStatus(event.target.value as QuoteStatus | ""))}>
            <option value="">Todos</option>
            {(Object.keys(quoteStatusLabels) as QuoteStatus[]).map((value) => <option key={value} value={value}>{quoteStatusLabels[value]}</option>)}
          </select>
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">Proformas</p><h2>{total} {total === 1 ? "resultado" : "resultados"}</h2></div></div>
        {data === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : data.items.length ? (
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead><tr><th>Proforma</th><th>Fecha</th><th>Cliente</th><th>Válida hasta</th><th>Estado</th><th>Total</th><th /></tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.number}</strong></td>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{item.customerName ?? "—"}</td>
                    <td>{formatDateTime(item.validUntil)}</td>
                    <td><span className={`order-status quote-${item.status.toLowerCase()}`}>{quoteStatusLabels[item.status]}</span></td>
                    <td className="sales-amount">{money(item.totalBob)}</td>
                    <td><Link className="row-action" href={`/sales/quotes/${item.id}`}>Ver detalle</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="catalog-empty"><span>✓</span><h3>No hay proformas con estos filtros.</h3><p>Crea una nueva o cambia el rango de fechas y el estado.</p></div>}
        {total > PAGE_SIZE ? (
          <div className="sales-pager">
            <button className="quiet-button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">← Anterior</button>
            <span>Página {page + 1} de {lastPage + 1}</span>
            <button className="quiet-button" disabled={page >= lastPage} onClick={() => setPage((current) => current + 1)} type="button">Siguiente →</button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
