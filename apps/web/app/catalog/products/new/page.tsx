"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { emptyProfile, ProductForm } from "../../../components/product-form";
import { catalogOptions, createProduct, listCategories, type CatalogCategory, type CatalogOptions, type ProductProfile } from "../../../lib/catalog";

export default function NewProductPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [options, setOptions] = useState<CatalogOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listCategories(), catalogOptions()])
      .then(([nextCategories, nextOptions]) => {
        setCategories(nextCategories);
        setOptions(nextOptions);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar el formulario."));
  }, []);

  async function save(profile: ProductProfile): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { id } = await createProduct(profile);
      // Tras crear, se agregan presentaciones y códigos desde el detalle.
      router.push(`/catalog/products/${id}?nuevo=1`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear el producto.");
      setBusy(false);
    }
  }

  return (
    <main className="catalog-page">
      <header className="catalog-header">
        <div>
          <Link className="back-link" href="/catalog">← Volver al catálogo</Link>
          <p className="eyebrow">Catálogo</p>
          <h1>Nuevo producto.</h1>
          <p className="catalog-lede">Completa la ficha. Después podrás agregar presentaciones (caja, blíster, unidad) y sus códigos de barras.</p>
        </div>
      </header>
      {error ? <p className="form-error catalog-message" role="alert">{error}</p> : null}
      <section className="panel profile-panel">
        <ProductForm busy={busy} categories={categories} initial={emptyProfile} onSubmit={(profile) => void save(profile)} options={options} submitLabel="Crear producto" />
      </section>
    </main>
  );
}
