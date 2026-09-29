"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { currentSession, type AuthSession } from "../lib/session";
import {
  createPriceList,
  findBarcode,
  listCategories,
  listPriceLists,
  listProducts,
  registerBarcode,
  saleClassificationLabels,
  setPrice,
  type BarcodeLookup,
  type CatalogCategory,
  type CatalogPriceList,
  type CatalogProductSummary
} from "../lib/catalog";

interface ProductPage {
  items: CatalogProductSummary[];
  total: number;
  limit: number;
  offset: number;
}

const emptyFilters = { categoryId: "", controlled: false, coldChain: false, includeInactive: false };

export default function CatalogPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [priceLists, setPriceLists] = useState<CatalogPriceList[]>([]);
  const [priceListName, setPriceListName] = useState("");
  const [priceCurrency, setPriceCurrency] = useState("BOB");
  const [priceListBranchScope, setPriceListBranchScope] = useState(false);
  const [selectedPriceListId, setSelectedPriceListId] = useState("");
  const [selectedPresentationId, setSelectedPresentationId] = useState("");
  const [priceAmount, setPriceAmount] = useState("");
  const [priceValidFrom, setPriceValidFrom] = useState("");
  const [priceValidTo, setPriceValidTo] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeLookup, setBarcodeLookup] = useState<BarcodeLookup | null>(null);

  useEffect(() => {
    currentSession()
      .then(async (value) => {
        setSession(value);
        try {
          await Promise.all([loadProducts("", emptyFilters), loadPriceLists(), listCategories().then(setCategories)]);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "No pudimos cargar el catálogo.");
        }
      })
      .catch(() => {
        window.location.assign("/");
      })
      .finally(() => setLoading(false));
  }, []);

  async function loadProducts(value: string, nextFilters: typeof emptyFilters): Promise<void> {
    setError(null);
    setProducts(await listProducts({ search: value, limit: 50, ...nextFilters }));
  }

  function changeFilters(patch: Partial<typeof emptyFilters>): void {
    const next = { ...filters, ...patch };
    setFilters(next);
    loadProducts(search, next).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar el catálogo."));
  }

  async function loadPriceLists(): Promise<void> {
    const lists = await listPriceLists();
    setPriceLists(lists);
    setSelectedPriceListId((current) => current || lists[0]?.id || "");
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSearch(draftSearch);
    try {
      await loadProducts(draftSearch, filters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar el catálogo.");
    }
  }

  async function createCatalogPriceList(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createPriceList({
        name: priceListName,
        currency: priceCurrency,
        branchId: priceListBranchScope ? session?.branchId : undefined
      });
      setPriceListName("");
      setNotice("Lista de precios creada para esta organización.");
      await loadPriceLists();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear la lista de precios.");
    } finally {
      setSaving(false);
    }
  }

  async function savePrice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await setPrice({
        priceListId: selectedPriceListId,
        presentationId: selectedPresentationId,
        amount: priceAmount,
        validFrom: new Date(priceValidFrom).toISOString(),
        validTo: priceValidTo ? new Date(priceValidTo).toISOString() : undefined
      });
      setPriceAmount("");
      setPriceValidFrom("");
      setPriceValidTo("");
      setNotice("Precio vigente registrado sin alterar el historial.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar el precio.");
    } finally {
      setSaving(false);
    }
  }

  async function saveBarcode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await registerBarcode({ presentationId: selectedPresentationId, barcode });
      setNotice("Código de barras registrado para la presentación seleccionada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos registrar el código de barras.");
    } finally {
      setSaving(false);
    }
  }

  async function lookupBarcode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const found = await findBarcode(barcode);
      setBarcodeLookup(found);
      if (!found) {
        setNotice("No encontramos un producto activo con ese código de barras.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos consultar el código de barras.");
    }
  }


  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando catálogo…</main>;
  }
  if (!session || !products) {
    return null;
  }

  const canManage = session.permissions.includes("catalog.manage");
  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Productos que sí puedes rastrear.</h1>
          <p className="catalog-lede">Ficha sanitaria, presentaciones y códigos de cada producto de tu farmacia.</p>
        </div>
        <div className="header-actions">
          {canManage ? <Link className="quiet-button" href="/catalog/categories">Categorías</Link> : null}
          {canManage ? <Link className="secondary-button" href="/catalog/products/new">+ Nuevo producto</Link> : null}
        </div>
      </header>
      <section className="catalog-toolbar">
        <form className="catalog-search" onSubmit={submitSearch}>
          <label htmlFor="catalog-search">Buscar por nombre, genérico, principio activo, laboratorio o código de barras</label>
          <div><input id="catalog-search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Ej. paracetamol" /><button className="search-button" type="submit">Buscar</button></div>
        </form>
        <div className="catalog-counter"><strong>{products.total.toString().padStart(2, "0")}</strong><span>{filters.includeInactive ? "productos" : "productos activos"}</span></div>
        <div className="catalog-filters">
          <label className="inventory-filter"><span>Categoría</span>
            <select value={filters.categoryId} onChange={(event) => changeFilters({ categoryId: event.target.value })}>
              <option value="">Todas</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="filter-check"><input checked={filters.controlled} onChange={(event) => changeFilters({ controlled: event.target.checked })} type="checkbox" /> Controlados</label>
          <label className="filter-check"><input checked={filters.coldChain} onChange={(event) => changeFilters({ coldChain: event.target.checked })} type="checkbox" /> Cadena de frío</label>
          <label className="filter-check"><input checked={filters.includeInactive} onChange={(event) => changeFilters({ includeInactive: event.target.checked })} type="checkbox" /> Mostrar desactivados</label>
        </div>
      </section>
      {error ? <p className="form-error catalog-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}
      <section className="product-list-panel catalog-list-full">
        <div className="panel-heading"><div><p className="section-kicker">Catálogo</p><h2>Productos</h2></div><span className="panel-count">{products.items.length.toString().padStart(2, "0")}</span></div>
        {products.items.length ? <div className="product-list">{products.items.map((product) => (
          <Link className={`product-row product-row-link ${product.isActive ? "" : "is-inactive"}`} href={`/catalog/products/${product.productId}`} key={product.productId}>
            <div className="product-avatar">{product.name.slice(0, 1).toUpperCase()}</div>
            <div className="product-copy">
              <h3>{product.name}{product.concentration ? <span className="title-detail"> {product.concentration}</span> : null}</h3>
              <p>{[product.genericName ?? product.activeIngredient, product.pharmaceuticalForm, product.laboratory].filter(Boolean).join(" · ") || "Ficha sin completar"}</p>
              <div className="product-badges">
                <span className={`product-badge badge-class-${product.saleClassification.toLowerCase()}`}>{saleClassificationLabels[product.saleClassification]}</span>
                {product.isControlled ? <span className="product-badge badge-controlled">Controlado</span> : null}
                {product.requiresColdChain ? <span className="product-badge badge-cold">Frío</span> : null}
                {!product.isActive ? <span className="product-badge badge-inactive">Desactivado</span> : null}
                <small>{product.categoryName ?? "Sin categoría"}</small>
              </div>
            </div>
            <div className="presentation-chips">{product.presentations.length ? product.presentations.map((presentation) => <span key={presentation.presentationId}>{presentation.name} · ×{presentation.baseUnitFactor}</span>) : <span className="chip-warning">Sin presentaciones</span>}</div>
          </Link>
        ))}</div> : <div className="catalog-empty"><span>✦</span><h3>No encontramos productos.</h3><p>{canManage ? "Prueba otra búsqueda o crea un producto nuevo." : "Prueba otra búsqueda."}</p></div>}
      </section>
      <section className="catalog-layout" aria-label="Precios y códigos de barras">
        <section className="product-list-panel">
          <div className="panel-heading"><div><p className="section-kicker">Precios operativos</p><h2>Vigencias y listas</h2></div><span className="panel-count">{priceLists.length.toString().padStart(2, "0")}</span></div>
          {canManage ? <div className="product-form">
            <form onSubmit={createCatalogPriceList}>
              <label className="field"><span>Nueva lista</span><input required value={priceListName} onChange={(event) => setPriceListName(event.target.value)} placeholder="Ej. Lista general" /></label>
              <label className="field"><span>Moneda ISO</span><input required maxLength={3} value={priceCurrency} onChange={(event) => setPriceCurrency(event.target.value.toUpperCase())} /></label>
              <label className="field"><span><input type="checkbox" checked={priceListBranchScope} onChange={(event) => setPriceListBranchScope(event.target.checked)} /> Solo esta sucursal</span></label>
              <button className="secondary-button" disabled={saving} type="submit">Crear lista</button>
            </form>
            <form onSubmit={savePrice}>
              <label className="field"><span>Lista activa</span><select required value={selectedPriceListId} onChange={(event) => setSelectedPriceListId(event.target.value)}><option value="">Selecciona una lista</option>{priceLists.map((list) => <option key={list.id} value={list.id}>{list.name} · {list.currency}{list.branchId ? " · sucursal" : " · global"}</option>)}</select></label>
              <label className="field"><span>Presentación</span><select required value={selectedPresentationId} onChange={(event) => setSelectedPresentationId(event.target.value)}><option value="">Selecciona una presentación</option>{products.items.flatMap((product) => product.presentations.map((presentation) => <option key={presentation.presentationId} value={presentation.presentationId}>{product.name} · {presentation.name}</option>))}</select></label>
              <label className="field"><span>Monto exacto</span><input required inputMode="decimal" pattern="\d+(\.\d{1,4})?" value={priceAmount} onChange={(event) => setPriceAmount(event.target.value)} placeholder="12.5000" /></label>
              <label className="field"><span>Válido desde</span><input required type="datetime-local" value={priceValidFrom} onChange={(event) => setPriceValidFrom(event.target.value)} /></label>
              <label className="field"><span>Válido hasta <small>opcional</small></span><input type="datetime-local" value={priceValidTo} onChange={(event) => setPriceValidTo(event.target.value)} /></label>
              <p className="form-note">Las vigencias de una misma presentación y alcance no se superponen. La lista de sucursal prevalece sobre la global.</p>
              <button className="primary-button" disabled={saving || !priceLists.length} type="submit">{saving ? "Guardando…" : "Registrar precio"}<span>↗</span></button>
            </form>
          </div> : <p className="empty-copy">Tu sesión puede consultar el catálogo, pero no tiene permiso para administrar sus precios.</p>}
        </section>
        <aside className="create-product-panel">
          <div className="panel-heading"><div><p className="section-kicker">Lectura rápida</p><h2>Código de barras</h2></div><span className="sparkle">⌁</span></div>
          <form className="product-form" onSubmit={lookupBarcode}>
            <label className="field"><span>Código</span><input required value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="780000000001" /></label>
            <button className="secondary-button" type="submit">Buscar código</button>
          </form>
          {canManage ? <form className="product-form" onSubmit={saveBarcode}>
            <label className="field"><span>Presentación a registrar</span><select required value={selectedPresentationId} onChange={(event) => setSelectedPresentationId(event.target.value)}><option value="">Selecciona una presentación</option>{products.items.flatMap((product) => product.presentations.map((presentation) => <option key={presentation.presentationId} value={presentation.presentationId}>{product.name} · {presentation.name}</option>))}</select></label>
            <button className="primary-button" disabled={saving} type="submit">Registrar código<span>↗</span></button>
          </form> : null}
          {barcodeLookup ? <div className="catalog-empty"><h3>{barcodeLookup.productName}</h3><p>{barcodeLookup.presentationName} · {barcodeLookup.baseUnitFactor} unidades</p><p>{barcodeLookup.priceAmount ? `${barcodeLookup.priceAmount} ${barcodeLookup.priceCurrency}` : "Sin precio vigente"}</p></div> : null}
        </aside>
      </section>
    </main>
  );
}
