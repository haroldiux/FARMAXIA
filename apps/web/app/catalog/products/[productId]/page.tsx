"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ProductForm } from "../../../components/product-form";
import {
  catalogOptions,
  createPresentation,
  getProduct,
  listCategories,
  registerBarcode,
  saleClassificationLabels,
  updatePresentation,
  updateProduct,
  type CatalogCategory,
  type CatalogOptions,
  type CatalogProductDetail,
  type ProductProfile
} from "../../../lib/catalog";
import { catalogDetailMode } from "../../../lib/catalog-access";
import { formatDate } from "../../../lib/saas";
import { currentSession, type AuthSession } from "../../../lib/session";

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [product, setProduct] = useState<CatalogProductDetail | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [presentationForm, setPresentationForm] = useState({ name: "", factor: "1", isSellable: true });
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [presentationFormKey, setPresentationFormKey] = useState(0);

  const load = useCallback(async () => setProduct(await getProduct(productId)), [productId]);

  useEffect(() => {
    let mounted = true;
    async function bootstrap(): Promise<void> {
      try {
        const value = await currentSession();
        if (!mounted) return;
        setSession(value);
        const mode = catalogDetailMode(value.permissions);
        if (mode === "denied") return;

        const loaders = [load()];
        if (mode === "manage") {
          loaders.push(listCategories().then(setCategories), catalogOptions().then(setOptions));
          if (new URLSearchParams(window.location.search).get("nuevo") === "1") {
            setNotice("Producto creado. Ahora agrega sus presentaciones: por ejemplo Caja x 20 (factor 20) y Unidad (factor 1).");
          }
        }
        await Promise.all(loaders);
      } catch (reason) {
        if (mounted) {
          setError(reason instanceof Error ? reason.message : "No pudimos cargar el producto.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => { mounted = false; };
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    if (catalogDetailMode(session?.permissions ?? []) !== "manage") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar los cambios.");
    } finally {
      setBusy(false);
    }
  }

  function saveProfile(profile: ProductProfile): void {
    void run(() => updateProduct(productId, profile), "Ficha actualizada. El cambio quedó registrado en Auditoría.");
  }

  function addPresentation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      await createPresentation(productId, {
        name: presentationForm.name,
        baseUnitFactor: Number(presentationForm.factor),
        isSellable: presentationForm.isSellable
      });
      setPresentationForm({ name: "", factor: "1", isSellable: true });
      setPresentationFormKey((key) => key + 1);
    }, "Presentación agregada.");
  }

  function addBarcode(presentationId: string): void {
    const barcode = barcodes[presentationId]?.trim();
    if (!barcode) return;
    void run(async () => {
      await registerBarcode({ presentationId, barcode });
      setBarcodes((current) => ({ ...current, [presentationId]: "" }));
      setPresentationFormKey((key) => key + 1);
    }, `Código ${barcode} registrado.`);
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando producto…</main>;
  }
  if (!session) {
    return <main className="center-state inventory-denied"><div><strong>No pudimos validar tu sesión</strong><p>{error ?? "Vuelve a ingresar para consultar el catálogo."}</p><Link href="/">Volver al ingreso</Link></div></main>;
  }

  const mode = catalogDetailMode(session.permissions);
  if (mode === "denied") {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu sesión no tiene permiso para consultar este producto.</p><Link href="/catalog">Volver al catálogo</Link></div></main>;
  }
  if (!product) {
    return error
      ? <main className="center-state inventory-denied"><div><strong>Producto no disponible</strong><p>{error}</p><Link href="/catalog">Volver al catálogo</Link></div></main>
      : <main className="center-state"><span className="loading-orb" />Cargando producto…</main>;
  }

  const { presentations } = product;
  const canManage = mode === "manage";

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div>
          <Link className="back-link" href="/catalog">← Volver al catálogo</Link>
          <p className="eyebrow">{product.laboratory ?? "Producto"}</p>
          <h1>{product.name}{product.concentration ? <span className="title-detail"> {product.concentration}</span> : null}</h1>
          <div className="product-badges">
            <span className={`product-badge badge-class-${product.saleClassification.toLowerCase()}`}>{saleClassificationLabels[product.saleClassification]}</span>
            {product.isControlled ? <span className="product-badge badge-controlled">Controlado</span> : null}
            {product.requiresColdChain ? <span className="product-badge badge-cold">Frío {product.coldChainMinCelsius}–{product.coldChainMaxCelsius} °C</span> : null}
            {!product.isActive ? <span className="product-badge badge-inactive">Desactivado</span> : null}
          </div>
        </div>
        {canManage ? <button
          className={product.isActive ? "row-action row-action-danger" : "secondary-button"}
          disabled={busy}
          onClick={() => {
            if (!product.isActive || window.confirm(`¿Desactivar ${product.name}? No aparecerá en ventas ni compras; su historial se conserva.`)) {
              void run(() => updateProduct(productId, { isActive: !product.isActive }), product.isActive ? "Producto desactivado." : "Producto reactivado.");
            }
          }}
          type="button"
        >
          {product.isActive ? "Desactivar producto" : "Reactivar producto"}
        </button> : null}
      </header>

      {error ? <p className="form-error catalog-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      <section className="catalog-layout product-detail-layout">
        <article className="panel profile-panel">
          <div className="panel-heading"><div><p className="section-kicker">Ficha sanitaria</p><h2>Datos del producto</h2></div></div>
          {canManage ? <ProductForm
            busy={busy}
            categories={categories}
            initial={product}
            key={product.updatedAt}
            onSubmit={saveProfile}
            options={options}
            submitLabel="Guardar ficha"
          /> : <ProductReadOnlyProfile product={product} />}
          <p className="form-note">Creado el {formatDate(product.createdAt)} · última modificación {formatDate(product.updatedAt, true)}.</p>
        </article>

        <aside className="panel presentations-panel">
          <div className="panel-heading"><div><p className="section-kicker">Fraccionamiento</p><h2>Presentaciones</h2></div><span className="panel-count">{presentations.length.toString().padStart(2, "0")}</span></div>
          <p className="form-note">El factor indica cuántas unidades mínimas trae: Caja x 20 tabletas = 20, Blíster x 10 = 10, Unidad = 1. No se puede cambiar después.</p>

          <div className="presentation-list">
            {presentations.length ? presentations.map((presentation) => (
              <article className={`presentation-card ${presentation.isActive ? "" : "is-inactive"}`} key={presentation.presentationId}>
                <div className="presentation-head">
                  {canManage && renaming?.id === presentation.presentationId ? (
                    <form className="inline-rename" onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => { await updatePresentation(presentation.presentationId, { name: renaming.name }); setRenaming(null); }, "Nombre actualizado.");
                    }}>
                      <input aria-label="Nuevo nombre" maxLength={160} required value={renaming.name} onChange={(event) => setRenaming({ id: presentation.presentationId, name: event.target.value })} />
                      <button className="row-action" disabled={busy} type="submit">Guardar</button>
                    </form>
                  ) : (
                    <div>
                      <strong>{presentation.name}</strong>
                      <small>× {presentation.baseUnitFactor} {presentation.baseUnitFactor === 1 ? "unidad" : "unidades"}{presentation.currentPrice ? ` · ${presentation.currentPrice.amount} ${presentation.currentPrice.currency}` : " · sin precio vigente"}</small>
                    </div>
                  )}
                  <span className={`order-status ${presentation.isActive ? (presentation.isSellable ? "order-paid" : "order-open") : "order-canceled"}`}>
                    {!presentation.isActive ? "Desactivada" : presentation.isSellable ? "Se vende" : "Solo compra"}
                  </span>
                </div>
                {presentation.barcodes.length ? <div className="chip-row">{presentation.barcodes.map((code) => <span className="chip mono" key={code}>{code}</span>)}</div> : null}
                {canManage && presentation.isActive ? (
                  <form className="barcode-add" onSubmit={(event) => { event.preventDefault(); addBarcode(presentation.presentationId); }}>
                    <input aria-label="Código de barras" inputMode="numeric" maxLength={80} value={barcodes[presentation.presentationId] ?? ""} onChange={(event) => setBarcodes({ ...barcodes, [presentation.presentationId]: event.target.value })} placeholder="Escanea o escribe un código" />
                    <button className="row-action" disabled={busy || !barcodes[presentation.presentationId]?.trim()} type="submit">Agregar código</button>
                  </form>
                ) : null}
                {canManage ? <div className="presentation-actions">
                  <button className="row-action" disabled={busy} onClick={() => setRenaming({ id: presentation.presentationId, name: presentation.name })} type="button">Renombrar</button>
                  {presentation.isActive ? (
                    <button className="row-action" disabled={busy} onClick={() => void run(() => updatePresentation(presentation.presentationId, { isSellable: !presentation.isSellable }), presentation.isSellable ? "Ya no se vende en esta presentación." : "Ahora se vende en esta presentación.")} type="button">
                      {presentation.isSellable ? "No vender" : "Vender"}
                    </button>
                  ) : null}
                  <button className={`row-action ${presentation.isActive ? "row-action-danger" : ""}`} disabled={busy} onClick={() => void run(() => updatePresentation(presentation.presentationId, { isActive: !presentation.isActive }), presentation.isActive ? "Presentación desactivada." : "Presentación reactivada.")} type="button">
                    {presentation.isActive ? "Desactivar" : "Reactivar"}
                  </button>
                </div> : null}
              </article>
            )) : <p className="empty-copy">Aún no tiene presentaciones.</p>}
          </div>

          {canManage ? <form className="product-form presentation-new" key={presentationFormKey} onSubmit={addPresentation}>
            <p className="section-kicker">Nueva presentación</p>
            <div className="presentation-new-grid">
              <label className="field"><span>Nombre</span><input maxLength={160} required value={presentationForm.name} onChange={(event) => setPresentationForm({ ...presentationForm, name: event.target.value })} placeholder="Ej. Caja x 20 tabletas" /></label>
              <label className="field"><span>Factor</span><input inputMode="numeric" min={1} pattern="\d+" required value={presentationForm.factor} onChange={(event) => setPresentationForm({ ...presentationForm, factor: event.target.value.replace(/\D/g, "") })} /></label>
            </div>
            <label className="field"><span><input checked={presentationForm.isSellable} onChange={(event) => setPresentationForm({ ...presentationForm, isSellable: event.target.checked })} type="checkbox" /> Se vende en esta presentación</span></label>
            <button className="secondary-button" disabled={busy || !product.isActive} type="submit">Agregar presentación</button>
          </form> : null}
        </aside>
      </section>
    </main>
  );
}

function ProductReadOnlyProfile({ product }: Readonly<{ product: CatalogProductDetail }>) {
  const value = (item: string | null): string => item || "Sin registrar";
  return (
    <>
      <p className="form-note">Tu sesión puede consultar esta ficha y sus presentaciones, pero no modificar el catálogo.</p>
      <dl className="detail-list">
        <div><dt>Nombre genérico</dt><dd>{value(product.genericName)}</dd></div>
        <div><dt>Principio activo</dt><dd>{value(product.activeIngredient)}</dd></div>
        <div><dt>Forma farmacéutica</dt><dd>{value(product.pharmaceuticalForm)}</dd></div>
        <div><dt>Categoría</dt><dd>{value(product.categoryName)}</dd></div>
        <div><dt>Registro sanitario</dt><dd>{value(product.sanitaryRegistration)}</dd></div>
        <div><dt>Clasificación de venta</dt><dd>{saleClassificationLabels[product.saleClassification]}</dd></div>
        <div><dt>Códigos SIN</dt><dd>{[product.sinActivityCode, product.sinProductCode, product.sinUnitCode].filter(Boolean).join(" · ") || "Sin registrar"}</dd></div>
        {product.requiresColdChain ? <div><dt>Cadena de frío</dt><dd>{product.coldChainMinCelsius}–{product.coldChainMaxCelsius} °C</dd></div> : null}
      </dl>
    </>
  );
}