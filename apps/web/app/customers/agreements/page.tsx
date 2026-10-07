"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { AgreementMembers } from "../../components/agreement-members";
import { CustomersNav } from "../../components/customers-nav";
import { CrmDenied, CrmHeader, CrmPlanRequired, useCrmSession } from "../../components/customers-shared";
import {
  agreementKindLabels,
  createAgreement,
  errorMessage,
  isPlanRestricted,
  listAgreements,
  money,
  planAllows,
  updateAgreement,
  type Agreement,
  type AgreementKind,
  type Paged
} from "../../lib/customers";

interface AgreementDraft {
  name: string;
  kind: AgreementKind;
  payerName: string;
  payerTaxId: string;
  coveragePercent: string;
  monthlyLimitBob: string;
  notes: string;
  isActive: boolean;
}

const emptyDraft = (): AgreementDraft => ({ name: "", kind: "INSURER", payerName: "", payerTaxId: "", coveragePercent: "80", monthlyLimitBob: "", notes: "", isActive: true });

function draftFrom(agreement: Agreement): AgreementDraft {
  return {
    name: agreement.name,
    kind: agreement.kind,
    payerName: agreement.payerName,
    payerTaxId: agreement.payerTaxId ?? "",
    coveragePercent: Number(agreement.coveragePercent).toString(),
    monthlyLimitBob: Number(agreement.monthlyLimitBob).toString(),
    notes: agreement.notes ?? "",
    isActive: agreement.isActive
  };
}

/** Agreements (insurers, companies, unions): the agreement covers a % of each sale up to a monthly credit per member. */
export default function AgreementsPage() {
  const { session, features } = useCrmSession();
  const [data, setData] = useState<Paged<Agreement> | null>(null);
  const [selected, setSelected] = useState<Agreement | null>(null);
  const [draft, setDraft] = useState<AgreementDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [saving, setSaving] = useState(false);

  const canRead = (session?.permissions.includes("agreements.manage") || session?.permissions.includes("agreements.billing")) ?? false;
  const canManage = session?.permissions.includes("agreements.manage") ?? false;
  const planKnown = features !== undefined;
  const planOk = planAllows(features, "crm.agreements");

  const load = useCallback(async () => {
    try {
      setData(await listAgreements({ limit: 200 }));
    } catch (failure) {
      if (isPlanRestricted(failure)) setRestricted(true);
      else setError(errorMessage(failure, "No pudimos cargar los convenios."));
    }
  }, []);

  useEffect(() => {
    if (canRead && planKnown && planOk) void load();
  }, [canRead, planKnown, planOk, load]);

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!canRead) return <CrmDenied />;

  const editingId = draft && selected ? selected.id : null;

  function update<K extends keyof AgreementDraft>(key: K, value: AgreementDraft[K]): void {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    const input = {
      name: draft.name.trim(),
      kind: draft.kind,
      payerName: draft.payerName.trim(),
      payerTaxId: draft.payerTaxId.trim() === "" ? null : draft.payerTaxId.trim(),
      coveragePercent: draft.coveragePercent.trim(),
      monthlyLimitBob: draft.monthlyLimitBob.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim()
    };
    try {
      const saved = editingId ? await updateAgreement(editingId, { ...input, isActive: draft.isActive }) : await createAgreement(input);
      setSelected(saved);
      setDraft(null);
      setNotice(editingId ? "Convenio actualizado." : "Convenio creado. Ahora afilia a sus clientes.");
      await load();
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos guardar el convenio."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="procurement-page">
      <CrmHeader kicker="Clientes · Convenios" title="Convenios con aseguradoras y empresas." lede="El convenio cubre un porcentaje de cada venta hasta el crédito mensual de cada afiliado; el cliente paga la diferencia. Se cobra después con un estado de cuenta mensual." />
      <CustomersNav />
      {!planOk || restricted ? <CrmPlanRequired plan="Premium" what="Los convenios" /> : (
        <>
          {error && !draft ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
          {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}
          <section className="cash-layout">
            <article className="panel">
              <div className="panel-heading">
                <div><p className="section-kicker">Convenios</p><h2>{data?.total ?? 0} {data?.total === 1 ? "convenio" : "convenios"}</h2></div>
                {canManage ? <button className="primary-button" onClick={() => { setSelected(null); setDraft({ ...emptyDraft() }); setError(null); setNotice(null); }} type="button">Nuevo convenio</button> : null}
              </div>
              {data === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : data.items.length ? (
                <div className="category-list">
                  {data.items.map((agreement) => (
                    <button className={`category-row payable-row ${selected?.id === agreement.id ? "is-selected" : ""} ${agreement.isActive ? "" : "is-inactive"}`} key={agreement.id} onClick={() => { setSelected(agreement); setDraft(null); setError(null); setNotice(null); }} type="button">
                      <div>
                        <strong>{agreement.name}</strong>
                        <small>{agreementKindLabels[agreement.kind]} · {agreement.payerName} · cubre {Number(agreement.coveragePercent)}% · hasta {money(agreement.monthlyLimitBob)}/mes{agreement.isActive ? "" : " · Inactivo"}</small>
                      </div>
                      <div className="payable-row-side"><strong>{agreement.memberCount}</strong><small>afiliados</small></div>
                    </button>
                  ))}
                </div>
              ) : <div className="catalog-empty"><span>✦</span><h3>Aún no hay convenios.</h3><p>{canManage ? "Crea el primero con «Nuevo convenio»." : "Pide a un responsable que cree el primero."}</p></div>}
            </article>

            <aside className="panel cash-form-panel">
              {draft ? (
                <form className="cash-form" onSubmit={save}>
                  <div className="panel-heading"><div><p className="section-kicker">{editingId ? "Editar" : "Nuevo"}</p><h2>{editingId ? "Datos del convenio" : "Crear convenio"}</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setDraft(null)} type="button">×</button></div>
                  {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
                  <label className="field"><span>Nombre del convenio</span><input autoFocus maxLength={120} required value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
                  <label className="field"><span>Tipo</span>
                    <select value={draft.kind} onChange={(event) => update("kind", event.target.value as AgreementKind)}>
                      {(Object.keys(agreementKindLabels) as AgreementKind[]).map((kind) => <option key={kind} value={kind}>{agreementKindLabels[kind]}</option>)}
                    </select>
                  </label>
                  <div className="procurement-field-grid">
                    <label className="field"><span>Entidad pagadora</span><input maxLength={160} required value={draft.payerName} onChange={(event) => update("payerName", event.target.value)} /></label>
                    <label className="field"><span>NIT <small>opcional</small></span><input maxLength={40} value={draft.payerTaxId} onChange={(event) => update("payerTaxId", event.target.value)} /></label>
                  </div>
                  <div className="procurement-field-grid">
                    <label className="field"><span>Cobertura (% de la venta)</span><input inputMode="decimal" required value={draft.coveragePercent} onChange={(event) => update("coveragePercent", event.target.value)} /></label>
                    <label className="field"><span>Crédito mensual por afiliado (Bs)</span><input inputMode="decimal" required value={draft.monthlyLimitBob} onChange={(event) => update("monthlyLimitBob", event.target.value)} /></label>
                  </div>
                  <label className="field"><span>Notas <small>opcional</small></span><textarea maxLength={500} rows={2} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
                  {editingId ? <label className="field"><span><input checked={draft.isActive} type="checkbox" onChange={(event) => update("isActive", event.target.checked)} /> Convenio activo</span></label> : null}
                  <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear convenio"}<span>↗</span></button>
                </form>
              ) : selected ? (
                <>
                  <div className="panel-heading">
                    <div><p className="section-kicker">{agreementKindLabels[selected.kind]}</p><h2>{selected.name}</h2></div>
                    <button aria-label="Cerrar" className="close-action" onClick={() => setSelected(null)} type="button">×</button>
                  </div>
                  <p className="field-hint">Paga: {selected.payerName}{selected.payerTaxId ? ` (NIT ${selected.payerTaxId})` : ""} · cubre {Number(selected.coveragePercent)}% de cada venta · crédito mensual por afiliado {money(selected.monthlyLimitBob)}{selected.isActive ? "" : " · Inactivo"}{selected.notes ? <><br />{selected.notes}</> : null}</p>
                  {canManage ? <div className="user-actions"><button className="row-action" onClick={() => { setDraft(draftFrom(selected)); setError(null); setNotice(null); }} type="button">Editar convenio</button></div> : null}
                  {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
                  <AgreementMembers agreement={selected} canManage={canManage} onChanged={() => void load()} />
                </>
              ) : (
                <div className="inventory-action-placeholder">
                  <span className="empty-symbol">✦</span>
                  <h2>Elige un convenio</h2>
                  <p>Para ver y administrar sus afiliados, o crea uno nuevo.</p>
                </div>
              )}
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
