"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  addAgreementMember,
  docLabel,
  errorMessage,
  listAgreementMembers,
  listCustomers,
  money,
  updateAgreementMember,
  type Agreement,
  type AgreementMember,
  type Customer
} from "../lib/customers";

interface MemberDraft {
  /** Set when editing an existing member. */
  memberId: string | null;
  customer: Customer | null;
  memberCode: string;
  limit: string;
  isActive: boolean;
}

const emptyDraft = (): MemberDraft => ({ memberId: null, customer: null, memberCode: "", limit: "", isActive: true });

/** Members of one agreement: list with this month's credit, add a customer, edit code/limit and (de)activate. */
export function AgreementMembers({ agreement, canManage, onChanged }: Readonly<{ agreement: Agreement; canManage: boolean; onChanged: () => void }>) {
  const [members, setMembers] = useState<AgreementMember[] | null>(null);
  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers((await listAgreementMembers(agreement.id)).items);
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos cargar los afiliados."));
    }
  }, [agreement.id]);

  useEffect(() => {
    setMembers(null);
    setDraft(null);
    setError(null);
    void load();
  }, [load]);

  // Customer lookup while adding a member.
  useEffect(() => {
    const text = search.trim();
    if (!draft || draft.memberId || draft.customer || text.length < 2) {
      setMatches([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      listCustomers({ q: text, active: "true", limit: 6 }, controller.signal)
        .then((result) => setMatches(result.items))
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, draft]);

  function startEdit(member: AgreementMember): void {
    setError(null);
    setDraft({ memberId: member.id, customer: null, memberCode: member.memberCode, limit: member.monthlyLimitBob === null ? "" : Number(member.monthlyLimitBob).toString(), isActive: member.isActive });
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.memberId) {
        await updateAgreementMember(agreement.id, draft.memberId, { memberCode: draft.memberCode.trim(), monthlyLimitBob: draft.limit.trim() === "" ? null : draft.limit.trim(), isActive: draft.isActive });
      } else {
        if (!draft.customer) {
          setError("Elige un cliente para afiliar.");
          setSaving(false);
          return;
        }
        await addAgreementMember(agreement.id, {
          customerId: draft.customer.id,
          memberCode: draft.memberCode.trim(),
          ...(draft.limit.trim() === "" ? {} : { monthlyLimitBob: draft.limit.trim() })
        });
      }
      setDraft(null);
      setSearch("");
      await load();
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos guardar el afiliado."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="payment-history">
      <div className="panel-heading">
        <div><p className="section-kicker">Afiliados</p></div>
        {canManage ? <button className="row-action" onClick={() => { setError(null); setSearch(""); setDraft(emptyDraft()); }} type="button">Afiliar cliente</button> : null}
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}

      {draft ? (
        <form className="cash-form" onSubmit={save}>
          {draft.memberId ? null : draft.customer ? (
            <div className="payment-row"><div><strong>{draft.customer.fullName}</strong><small>{docLabel(draft.customer.docType, draft.customer.docNumber)}</small></div><button className="row-action" onClick={() => setDraft({ ...draft, customer: null })} type="button">Cambiar</button></div>
          ) : (
            <div>
              <label className="field"><span>Cliente (nombre o documento)</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              {matches.length ? <ul className="pos-results" role="listbox">{matches.map((customer) => (
                <li key={customer.id} role="option" aria-selected="false">
                  <button className="pos-result" onClick={() => { setDraft({ ...draft, customer }); setMatches([]); }} type="button">
                    <span className="pos-result-main"><strong>{customer.fullName}</strong><small>{docLabel(customer.docType, customer.docNumber)}</small></span>
                  </button>
                </li>
              ))}</ul> : search.trim().length >= 2 ? <p className="field-hint">Sin resultados. Registra al cliente primero en Clientes.</p> : null}
            </div>
          )}
          <div className="procurement-field-grid">
            <label className="field"><span>Código de afiliado</span><input maxLength={40} required value={draft.memberCode} onChange={(event) => setDraft({ ...draft, memberCode: event.target.value })} /></label>
            <label className="field"><span>Límite mensual propio (Bs) <small>vacío = el del convenio</small></span><input inputMode="decimal" value={draft.limit} onChange={(event) => setDraft({ ...draft, limit: event.target.value })} placeholder={Number(agreement.monthlyLimitBob).toString()} /></label>
          </div>
          {draft.memberId ? <label className="field"><span><input checked={draft.isActive} type="checkbox" onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /> Afiliado activo</span></label> : null}
          <div className="user-actions">
            <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : draft.memberId ? "Guardar afiliado" : "Afiliar"}</button>
            <button className="quiet-button" disabled={saving} onClick={() => setDraft(null)} type="button">Cancelar</button>
          </div>
        </form>
      ) : null}

      {members === null ? <p className="field-hint">Cargando…</p> : members.length ? members.map((member) => (
        <div className={`payment-row ${member.isActive ? "" : "is-inactive"}`} key={member.id}>
          <div>
            <strong>{member.customerName} · {member.memberCode}{member.isActive ? "" : " (inactivo)"}</strong>
            <small>{docLabel(member.docType, member.docNumber)} · límite {money(member.effectiveLimitBob)}{member.monthlyLimitBob === null ? " (del convenio)" : ""} · usado este mes {money(member.usedBob)} · disponible {money(member.remainingBob)}</small>
          </div>
          {canManage ? <button className="row-action" onClick={() => startEdit(member)} type="button">Editar</button> : null}
        </div>
      )) : <p className="field-hint">Todavía no hay afiliados en este convenio.</p>}
    </div>
  );
}
