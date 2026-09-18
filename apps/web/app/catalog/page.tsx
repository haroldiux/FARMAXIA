"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { authenticatedFetch, currentSession, logout, type AuthSession } from "../lib/session";

interface Presentation {
  presentationId: string;
  name: string;
  baseUnitFactor: number;
  isSellable: boolean;
}

interface Product {
  productId: string;
  name: string;
  activeIngredient: string | null;
  categoryName: string | null;
  presentations: Presentation[];
}

interface ProductPage {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export default function CatalogPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [productName, setProductName] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    currentSession()
      .then(async (value) => {
        setSession(value);
        try {
          await loadProducts("");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "No pudimos cargar el catálogo.");
        }
      })
      .catch(() => {
        window.location.assign("/");
      })
      .finally(() => setLoading(false));
  }, []);

  async function loadProducts(value: string): Promise<void> {
    setError(null);
    const params = new URLSearchParams({ limit: "50", offset: "0" });
    if (value.trim()) {
      params.set("search", value.trim());
    }
    const response = await authenticatedFetch(`/api/v1/catalog/products?${params.toString()}`);
    if (!response.ok) {
      throw new Error(response.status === 403 ? "Tu sesión no tiene permiso para consultar el catálogo." : "No pudimos cargar el catálogo.");
    }
    setProducts((await response.json()) as ProductPage);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSearch(draftSearch);
    try {
      await loadProducts(draftSearch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cargar el catálogo.");
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch("/api/v1/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: productName,
          activeIngredient: activeIngredient || undefined
        })
      });
      if (!response.ok) {
        throw new Error(response.status === 403 ? "Tu sesión no tiene permiso para crear productos." : "No pudimos guardar el producto.");
      }
      setProductName("");
      setActiveIngredient("");
      setNotice("Producto creado. Ya aparece en el catálogo.");
      await loadProducts(search);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar el producto.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut(): Promise<void> {
    await logout();
    window.location.assign("/");
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
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">F2 · Catálogo</p>
          <h1>Productos que sí puedes rastrear.</h1>
          <p className="catalog-lede">Consulta la base activa de tu organización y prepara sus presentaciones para las operaciones futuras.</p>
        </div>
        <button className="quiet-button" onClick={signOut} type="button">Cerrar sesión ↗</button>
      </header>
      <section className="catalog-toolbar">
        <form className="catalog-search" onSubmit={submitSearch}>
          <label htmlFor="catalog-search">Buscar por producto o principio activo</label>
          <div><input id="catalog-search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Ej. paracetamol" /><button className="search-button" type="submit">Buscar</button></div>
        </form>
        <div className="catalog-counter"><strong>{products.total.toString().padStart(2, "0")}</strong><span>productos activos</span></div>
      </section>
      {error ? <p className="form-error catalog-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}
      <div className="catalog-layout">
        <section className="product-list-panel">
          <div className="panel-heading"><div><p className="section-kicker">Inventario base</p><h2>Catálogo activo</h2></div><span className="panel-count">{products.items.length.toString().padStart(2, "0")}</span></div>
          {products.items.length ? <div className="product-list">{products.items.map((product) => <article className="product-row" key={product.productId}>
            <div className="product-avatar">{product.name.slice(0, 1).toUpperCase()}</div>
            <div className="product-copy"><h3>{product.name}</h3><p>{product.activeIngredient ?? "Principio activo no registrado"}</p><small>{product.categoryName ?? "Sin categoría"} · {product.presentations.length} {product.presentations.length === 1 ? "presentación" : "presentaciones"}</small></div>
            <div className="presentation-chips">{product.presentations.map((presentation) => <span key={presentation.presentationId}>{presentation.name} · ×{presentation.baseUnitFactor}</span>)}</div>
          </article>)}</div> : <div className="catalog-empty"><span>✦</span><h3>No encontramos productos.</h3><p>Prueba otra búsqueda o crea el primer producto desde el panel lateral.</p></div>}
        </section>
        <aside className="create-product-panel">
          <div className="panel-heading"><div><p className="section-kicker">Alta rápida</p><h2>Nuevo producto</h2></div><span className="sparkle">✦</span></div>
          {canManage ? <form className="product-form" onSubmit={createProduct}>
            <label className="field"><span>Nombre comercial</span><input required value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Ej. Paracetamol" /></label>
            <label className="field"><span>Principio activo <small>opcional</small></span><input value={activeIngredient} onChange={(event) => setActiveIngredient(event.target.value)} placeholder="Ej. Paracetamol 500 mg" /></label>
            <p className="form-note">La categoría y las presentaciones se pueden completar después desde el flujo de catálogo.</p>
            <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Crear producto"}<span>↗</span></button>
          </form> : <p className="empty-copy">Tu sesión puede consultar el catálogo, pero no tiene permiso para crear productos.</p>}
        </aside>
      </div>
    </main>
  );
}
