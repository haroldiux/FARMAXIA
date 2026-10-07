"use client";

import { useEffect, useState } from "react";
import {
  customerAgreements,
  customerLoyalty,
  docLabel,
  listCustomers,
  money,
  type Customer,
  type CustomerAgreement,
  type LoyaltySettings
} from "../lib/customers";

/** The customer chosen at the POS plus what they can pay with: points (crm.loyalty) and agreements (crm.agreements). */
export interface PosCustomer {
  customer: Customer;
  /** Null when the plan has no loyalty or the program is off. */
  points: { balance: number; settings: LoyaltySettings } | null;
  agreements: CustomerAgreement[];
}

/** Optional customer of the sale: search by name, document or phone; loads balance and agreements once chosen. */
export function PosCustomerPicker({ value, loyaltyPlan, agreementsPlan, disabled, onChange }: Readonly<{
  value: PosCustomer | null;
  loyaltyPlan: boolean;
  agreementsPlan: boolean;
  disabled?: boolean;
  onChange: (customer: PosCustomer | null) => void;
}>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (value || text.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      listCustomers({ q: text, active: "true", limit: 6 }, controller.signal)
        .then((result) => {
          setResults(result.items);
          setSearching(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  async function choose(customer: Customer): Promise<void> {
    setMessage(null);
    setQuery("");
    setResults([]);
    // Loyalty and agreement lookups fail soft: the sale still works with money methods.
    const [loyalty, agreements] = await Promise.all([
      loyaltyPlan ? customerLoyalty(customer.id, { limit: 1 }).catch(() => null) : Promise.resolve(null),
      agreementsPlan ? customerAgreements(customer.id).then((result) => result.items).catch(() => []) : Promise.resolve([] as CustomerAgreement[])
    ]);
    const points = loyalty && loyalty.settings.enabled ? { balance: loyalty.balance, settings: loyalty.settings } : null;
    onChange({ customer, points, agreements });
    if (loyaltyPlan && loyalty && !loyalty.settings.enabled) setMessage("El programa de puntos está desactivado.");
  }

  if (value) {
    const { customer, points, agreements } = value;
    return (
      <div className="pos-customer">
        <div className="payment-row">
          <div>
            <strong>{customer.fullName}</strong>
            <small>
              {docLabel(customer.docType, customer.docNumber)}
              {points ? ` · ${points.balance} pts (≈ ${money(points.balance * Number(points.settings.pointValueBob))})` : ""}
              {agreements.length ? ` · ${agreements.length} ${agreements.length === 1 ? "convenio" : "convenios"}` : ""}
            </small>
          </div>
          <button className="quiet-button pos-touch" disabled={disabled} onClick={() => onChange(null)} type="button">Quitar cliente</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-customer">
      <label className="inventory-filter"><span>Cliente <small>opcional · para puntos y convenios</small></span>
        <input autoComplete="off" disabled={disabled} placeholder="Nombre, documento o teléfono" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {searching ? <p className="pos-hint" aria-live="polite">Buscando…</p> : null}
      {query.trim().length >= 2 && !searching && !results.length ? <p className="pos-hint">Sin resultados. Regístralo en Clientes.</p> : null}
      {results.length ? (
        <ul className="pos-results" role="listbox" aria-label="Clientes">
          {results.map((customer) => (
            <li key={customer.id} role="option" aria-selected="false">
              <button className="pos-result" onClick={() => void choose(customer)} type="button">
                <span className="pos-result-main"><strong>{customer.fullName}</strong><small>{docLabel(customer.docType, customer.docNumber)}{customer.phone ? ` · ${customer.phone}` : ""}</small></span>
                {customer.loyaltyBalance !== null ? <span className="pos-result-side"><strong>{customer.loyaltyBalance} pts</strong></span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className="pos-hint">{message}</p> : null}
    </div>
  );
}
