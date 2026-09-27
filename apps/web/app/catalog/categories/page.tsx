"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createCategory, listCategories, updateCategory, type CatalogCategory } from "../../lib/catalog";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CatalogCategory[] | null>(null);
  const [name, setName] = useState("");
  const [isControlled, setIsControlled] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setCategories(await listCategories()), []);

  useEffect(() => {
    load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar las categorías."));
  }, [load]);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos guardar la categoría.");
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      await createCategory({ name, isControlled });
      setName("");
      setIsControlled(false);
    }, `Categoría ${name} creada.`);
  }

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div>
          <Link className="back-link" href="/catalog">← Volver al catálogo</Link>
          <p className="eyebrow">Catálogo</p>
          <h1>Categorías.</h1>
          <p className="catalog-lede">Agrupa tus productos. Una categoría controlada marca como controlados a todos sus productos.</p>
        </div>
      </header>
      {error ? <p className="form-error catalog-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success catalog-message" role="status">{notice}</p> : null}

      <section className="catalog-layout">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Organización</p><h2>Categorías</h2></div><span className="panel-count">{(categories?.length ?? 0).toString().padStart(2, "0")}</span></div>
          {categories === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : categories.length ? (
            <div className="category-list">
              {categories.map((category) => (
                <div className={`category-row ${category.isActive ? "" : "is-inactive"}`} key={category.id}>
                  {editing?.id === category.id ? (
                    <form className="inline-rename" onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => { await updateCategory(category.id, { name: editing.name }); setEditing(null); }, "Categoría renombrada.");
                    }}>
                      <input aria-label="Nuevo nombre" maxLength={160} required value={editing.name} onChange={(event) => setEditing({ id: category.id, name: event.target.value })} />
                      <button className="row-action" disabled={busy} type="submit">Guardar</button>
                      <button className="row-action" onClick={() => setEditing(null)} type="button">Cancelar</button>
                    </form>
                  ) : (
                    <div>
                      <strong>{category.name}</strong>
                      <small>{category.products} {category.products === 1 ? "producto" : "productos"}{category.isControlled ? " · controlada" : ""}{category.isActive ? "" : " · desactivada"}</small>
                    </div>
                  )}
                  <div className="user-actions">
                    <button className="row-action" disabled={busy} onClick={() => setEditing({ id: category.id, name: category.name })} type="button">Renombrar</button>
                    {!category.isControlled && category.isActive ? (
                      <button className="row-action" disabled={busy} onClick={() => {
                        if (window.confirm(`¿Marcar ${category.name} como controlada? Sus ${category.products} productos quedarán como controlados.`)) {
                          void run(() => updateCategory(category.id, { isControlled: true }), "Categoría marcada como controlada.");
                        }
                      }} type="button">Marcar controlada</button>
                    ) : null}
                    <button className={`row-action ${category.isActive ? "row-action-danger" : ""}`} disabled={busy} onClick={() => void run(() => updateCategory(category.id, { isActive: !category.isActive }), category.isActive ? "Categoría desactivada: ya no se ofrece para productos nuevos." : "Categoría reactivada.")} type="button">
                      {category.isActive ? "Desactivar" : "Reactivar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="catalog-empty"><span>✦</span><h3>Aún no hay categorías.</h3><p>Crea la primera desde el panel lateral.</p></div>}
        </article>

        <aside className="create-product-panel">
          <div className="panel-heading"><div><p className="section-kicker">Alta</p><h2>Nueva categoría</h2></div></div>
          <form className="product-form" onSubmit={create}>
            <label className="field"><span>Nombre</span><input maxLength={160} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Antibióticos" /></label>
            <label className="field"><span><input checked={isControlled} onChange={(event) => setIsControlled(event.target.checked)} type="checkbox" /> Categoría de medicamentos controlados</span></label>
            <button className="primary-button" disabled={busy} type="submit">{busy ? "Guardando…" : "Crear categoría"}<span aria-hidden="true">↗</span></button>
          </form>
        </aside>
      </section>
    </main>
  );
}
