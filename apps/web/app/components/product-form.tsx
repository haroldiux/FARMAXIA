"use client";

import { FormEvent, useState } from "react";
import {
  saleClassificationLabels,
  type CatalogCategory,
  type CatalogOptions,
  type ProductProfile,
  type SaleClassification
} from "../lib/catalog";

export const emptyProfile: ProductProfile = {
  name: "",
  categoryId: null,
  activeIngredient: null,
  genericName: null,
  concentration: null,
  pharmaceuticalForm: null,
  laboratory: null,
  sanitaryRegistration: null,
  saleClassification: "OTC",
  isControlled: false,
  requiresColdChain: false,
  coldChainMinCelsius: null,
  coldChainMaxCelsius: null,
  sinActivityCode: null,
  sinProductCode: null,
  sinUnitCode: null
};

type TextField = Exclude<keyof ProductProfile, "saleClassification" | "isControlled" | "requiresColdChain" | "categoryId">;

/**
 * Ficha sanitaria completa. La usan "Nuevo producto" y el detalle del producto; el
 * servidor vuelve a validar todo.
 */
export function ProductForm({
  initial,
  categories,
  options,
  submitLabel,
  busy,
  onSubmit
}: Readonly<{
  initial: ProductProfile;
  categories: CatalogCategory[];
  options: CatalogOptions | null;
  submitLabel: string;
  busy: boolean;
  onSubmit: (profile: ProductProfile) => void;
}>) {
  const [profile, setProfile] = useState<ProductProfile>(initial);
  const category = categories.find((item) => item.id === profile.categoryId);
  const controlledByRule = profile.saleClassification === "CONTROLLED" || Boolean(category?.isControlled);

  function text(field: TextField, value: string): void {
    setProfile((current) => ({ ...current, [field]: value === "" ? null : value }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit({ ...profile, isControlled: profile.isControlled || controlledByRule });
  }

  const input = (field: TextField, label: string, extra: Record<string, unknown> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={profile[field] ?? ""} onChange={(event) => text(field, event.target.value)} {...extra} />
    </label>
  );

  return (
    <form className="product-profile-form" onSubmit={submit}>
      <fieldset className="profile-section">
        <legend>Identificación</legend>
        <div className="profile-grid">
          <label className="field profile-wide">
            <span>Nombre comercial</span>
            <input maxLength={200} required value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="Ej. Amoxil" />
          </label>
          {input("genericName", "Nombre genérico (DCI)", { maxLength: 240, placeholder: "Ej. Amoxicilina" })}
          {input("activeIngredient", "Principio activo", { maxLength: 240, placeholder: "Ej. Amoxicilina trihidrato" })}
          {input("concentration", "Concentración", { maxLength: 120, placeholder: "Ej. 500 mg" })}
          <label className="field">
            <span>Forma farmacéutica</span>
            <input list="pharmaceutical-forms" maxLength={80} value={profile.pharmaceuticalForm ?? ""} onChange={(event) => text("pharmaceuticalForm", event.target.value)} placeholder="Ej. Cápsula" />
            <datalist id="pharmaceutical-forms">
              {(options?.pharmaceuticalForms ?? []).map((form) => <option key={form} value={form} />)}
            </datalist>
          </label>
          {input("laboratory", "Laboratorio / marca", { maxLength: 160, placeholder: "Ej. Laboratorios Bagó" })}
          <label className="field">
            <span>Categoría</span>
            <select value={profile.categoryId ?? ""} onChange={(event) => setProfile({ ...profile, categoryId: event.target.value || null })}>
              <option value="">Sin categoría</option>
              {categories.filter((item) => item.isActive || item.id === profile.categoryId).map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.isControlled ? " · controlada" : ""}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="profile-section">
        <legend>Regulación sanitaria</legend>
        <div className="profile-grid">
          {input("sanitaryRegistration", "Registro sanitario (AGEMED)", { maxLength: 80, placeholder: "Ej. NN-12345/2024" })}
          <label className="field">
            <span>Clasificación de venta</span>
            <select value={profile.saleClassification} onChange={(event) => setProfile({ ...profile, saleClassification: event.target.value as SaleClassification })}>
              {(options?.saleClassifications ?? (Object.keys(saleClassificationLabels) as SaleClassification[])).map((value) => (
                <option key={value} value={value}>{saleClassificationLabels[value]}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flag-row">
          <label className={`flag-option ${controlledByRule ? "is-forced" : ""}`}>
            <input checked={profile.isControlled || controlledByRule} disabled={controlledByRule} onChange={(event) => setProfile({ ...profile, isControlled: event.target.checked })} type="checkbox" />
            <span>
              <strong>Medicamento controlado</strong>
              <small>{controlledByRule ? (profile.saleClassification === "CONTROLLED" ? "Por su clasificación de venta." : "Por su categoría.") : "Psicotrópicos y estupefacientes."}</small>
            </span>
          </label>
          <label className="flag-option">
            <input checked={profile.requiresColdChain} onChange={(event) => setProfile({ ...profile, requiresColdChain: event.target.checked, coldChainMinCelsius: null, coldChainMaxCelsius: null })} type="checkbox" />
            <span><strong>Requiere cadena de frío</strong><small>Se conserva refrigerado.</small></span>
          </label>
        </div>
        {profile.requiresColdChain ? (
          <div className="profile-grid cold-range">
            {input("coldChainMinCelsius", "Temperatura mínima (°C)", { inputMode: "decimal", placeholder: String(options?.defaultColdChainRange.min ?? 2) })}
            {input("coldChainMaxCelsius", "Temperatura máxima (°C)", { inputMode: "decimal", placeholder: String(options?.defaultColdChainRange.max ?? 8) })}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="profile-section">
        <legend>Facturación (SIN)</legend>
        <div className="profile-grid profile-grid-3">
          {input("sinActivityCode", "Código de actividad", { inputMode: "numeric", maxLength: 10, pattern: "\\d*", placeholder: "Ej. 477300" })}
          {input("sinProductCode", "Código de producto SIN", { inputMode: "numeric", maxLength: 10, pattern: "\\d*", placeholder: "Ej. 35270" })}
          {input("sinUnitCode", "Unidad de medida SIN", { inputMode: "numeric", maxLength: 10, pattern: "\\d*", placeholder: "Ej. 57" })}
        </div>
        <p className="form-note">Solo números. Se usarán para facturar cuando se active la facturación SIAT.</p>
      </fieldset>

      <button className="primary-button" disabled={busy} type="submit">{busy ? "Guardando…" : submitLabel}<span aria-hidden="true">↗</span></button>
    </form>
  );
}
