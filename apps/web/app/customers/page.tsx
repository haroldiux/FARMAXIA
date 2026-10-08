"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { CustomerDetail } from "../components/customer-detail";
import { CustomersNav } from "../components/customers-nav";
import { CrmDenied, CrmHeader, useCrmSession } from "../components/customers-shared";
import {
  createCustomer,
  docLabel,
  docTypeLabels,
  errorMessage,
  listCustomers,
  planAllows,
  updateCustomer,
  type Customer,
  type CustomerInput,
  type DocType,
  type Paged
} from "../lib/customers";

const PAGE_SIZE = 20;

interface CustomerDraft {
  fullName: string;
  docType: DocType | "";
  docNumber: string;
  complement: string;
  phone: string;
  email: string;
  notes: string;
  isActive: boolean;
}

const emptyDraft = (): CustomerDraft => ({ fullName: "", docType: "", docNumber: "", complement: "", phone: "", email: "", notes: "", isActive: true });

function draftFrom(customer: Customer): CustomerDraft {
  return {
    fullName: customer.fullName,
    docType: customer.docType ?? "",
    docNumber: customer.docNumber ?? "",
    complement: customer.complement ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    notes: customer.notes ?? "",
    isActive: customer.isActive
  };
}

const blankToNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export default function CustomersPage() {
  const { session, features } = useCrmSession();
  const [data, setData] = useState<Paged<Customer> | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<"" | "true" | "false">("true");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<CustomerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowed = session?.permissions.includes("customers.manage") ?? false;

  // Debounce the text search so each keystroke does not hit the API.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setData(await listCustomers({ q: q || undefined, active: active || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos cargar los clientes."));
    }
  }, [q, active, page]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!allowed) return <CrmDenied />;

  // Optional sections wait for the plan snapshot so a plan without them never fires the (403) requests.
  const canLoyalty = features !== undefined && planAllows(features, "crm.loyalty");
  const canAdjust = canLoyalty && session.permissions.includes("loyalty.manage");
  const canAgreements = features !== undefined && planAllows(features, "crm.agreements");
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const editingId = draft && selected ? selected.id : null;

  function pick(customer: Customer): void {
    setSelected(customer);
    setDraft(null);
    setError(null);
    setNotice(null);
  }

  function startNew(): void {
    setSelected(null);
    setDraft(emptyDraft());
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    const input: CustomerInput = {
      fullName: draft.fullName.trim(),
      docType: draft.docNumber.trim() ? (draft.docType || null) : null,
      docNumber: blankToNull(draft.docNumber),
      complement: blankToNull(draft.complement),
      phone: blankToNull(draft.phone),
      email: blankToNull(draft.email),
      notes: blankToNull(draft.notes)
    };
    try {
      if (editingId) {
        const updated = await updateCustomer(editingId, { ...input, isActive: draft.isActive });
        setSelected(updated);
        setNotice("Cliente actualizado.");
      } else {
        const created = await createCustomer(input);
        setSelected(created);
        setNotice("Cliente registrado.");
      }
      setDraft(null);
      await load();
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos guardar el cliente."));
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]): void {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <main className="procurement-page">
      <CrmHeader kicker="Clientes" title="Quién te compra, a la mano." lede="Registra clientes, mira sus compras en esta sucursal y, si tu plan lo incluye, sus puntos y convenios." />
      <CustomersNav />
      {error && !draft ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      <section className="cash-layout">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="section-kicker">Clientes</p><h2>{total} {total === 1 ? "cliente" : "clientes"}</h2></div>
            <button className="primary-button" onClick={startNew} type="button">Nuevo cliente</button>
          </div>
          <div className="controlled-filters">
            <label className="inventory-filter"><span>Buscar</span><input placeholder="Nombre, documento o teléfono" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="inventory-filter"><span>Estado</span>
              <select value={active} onChange={(event) => { setActive(event.target.value as "" | "true" | "false"); setPage(0); }}>
                <option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option>
              </select>
            </label>
          </div>
          {data === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : data.items.length ? (
            <div className="category-list">
              {data.items.map((customer) => (
                <button className={`category-row payable-row ${selected?.id === customer.id ? "is-selected" : ""} ${customer.isActive ? "" : "is-inactive"}`} key={customer.id} onClick={() => pick(customer)} type="button">
                  <div>
                    <strong>{customer.fullName}</strong>
                    <small>{docLabel(customer.docType, customer.docNumber)}{customer.phone ? ` · ${customer.phone}` : ""}{customer.isActive ? "" : " · Inactivo"}</small>
                  </div>
                  {customer.loyaltyBalance !== null ? <div className="payable-row-side"><strong>{customer.loyaltyBalance} pts</strong></div> : null}
                </button>
              ))}
            </div>
          ) : <div className="catalog-empty"><span>✦</span><h3>No hay clientes con estos filtros.</h3><p>Registra uno nuevo o cambia la búsqueda.</p></div>}
          {total > PAGE_SIZE ? (
            <div className="sales-pager">
              <button className="quiet-button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">← Anterior</button>
              <span>Página {page + 1} de {lastPage + 1}</span>
              <button className="quiet-button" disabled={page >= lastPage} onClick={() => setPage((current) => current + 1)} type="button">Siguiente →</button>
            </div>
          ) : null}
        </article>

        <aside className="panel cash-form-panel">
          {draft ? (
            <form className="cash-form" onSubmit={save}>
              <div className="panel-heading"><div><p className="section-kicker">{editingId ? "Editar" : "Nuevo"}</p><h2>{editingId ? "Datos del cliente" : "Registrar cliente"}</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setDraft(null)} type="button">×</button></div>
              {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
              <label className="field"><span>Nombre completo</span><input autoFocus maxLength={160} required value={draft.fullName} onChange={(event) => update("fullName", event.target.value)} /></label>
              <div className="procurement-field-grid">
                <label className="field"><span>Tipo de documento</span>
                  <select value={draft.docType} onChange={(event) => update("docType", event.target.value as DocType | "")}>
                    <option value="">Sin documento</option>
                    {(Object.keys(docTypeLabels) as DocType[]).map((type) => <option key={type} value={type}>{docTypeLabels[type]}</option>)}
                  </select>
                </label>
                <label className="field"><span>Número</span><input maxLength={40} value={draft.docNumber} onChange={(event) => update("docNumber", event.target.value)} /></label>
              </div>
              <div className="procurement-field-grid">
                <label className="field"><span>Complemento <small>opcional</small></span><input maxLength={10} value={draft.complement} onChange={(event) => update("complement", event.target.value)} /></label>
                <label className="field"><span>Teléfono <small>opcional</small></span><input maxLength={40} value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label>
              </div>
              <label className="field"><span>Correo <small>opcional</small></span><input maxLength={160} type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} /></label>
              <label className="field"><span>Notas <small>opcional</small></span><textarea maxLength={500} rows={2} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
              {editingId ? <label className="field"><span><input checked={draft.isActive} type="checkbox" onChange={(event) => update("isActive", event.target.checked)} /> Cliente activo</span></label> : null}
              <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : editingId ? "Guardar cambios" : "Registrar cliente"}<span>↗</span></button>
            </form>
          ) : selected ? (
            <CustomerDetail
              canAdjust={canAdjust}
              canAgreements={canAgreements}
              canLoyalty={canLoyalty}
              customer={selected}
              onChanged={() => void load()}
              onClose={() => setSelected(null)}
              onEdit={() => setDraft(draftFrom(selected))}
            />
          ) : (
            <div className="inventory-action-placeholder">
              <span className="empty-symbol">✦</span>
              <h2>Elige un cliente</h2>
              <p>Para ver sus compras, puntos y convenios, o registra uno nuevo.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
