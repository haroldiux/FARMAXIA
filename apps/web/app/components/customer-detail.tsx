"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  adjustLoyalty,
  customerAgreements,
  customerLoyalty,
  customerPurchases,
  docLabel,
  errorMessage,
  formatDateTime,
  loyaltyKindLabels,
  money,
  type Customer,
  type CustomerAgreement,
  type CustomerLoyalty,
  type PurchaseHistory
} from "../lib/customers";
import { saleStatusLabels, type SaleStatus } from "../lib/sales";

const PAGE_SIZE = 10;

/** Purchases of the active branch, loyalty balance with its ledger, manual adjustment and agreements of one customer. */
export function CustomerDetail({ customer, canLoyalty, canAdjust, canAgreements, onEdit, onClose, onChanged }: Readonly<{
  customer: Customer;
  /** Plan has crm.loyalty. */
  canLoyalty: boolean;
  /** Plan has crm.loyalty and the user holds loyalty.manage. */
  canAdjust: boolean;
  /** Plan has crm.agreements. */
  canAgreements: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Called after a points adjustment so the list shows the new balance. */
  onChanged: () => void;
}>) {
  const [purchases, setPurchases] = useState<PurchaseHistory | null>(null);
  const [purchasePage, setPurchasePage] = useState(0);
  const [loyalty, setLoyalty] = useState<CustomerLoyalty | null>(null);
  const [loyaltyPage, setLoyaltyPage] = useState(0);
  const [agreements, setAgreements] = useState<CustomerAgreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // A different customer starts from page 1 of everything.
  useEffect(() => {
    setPurchasePage(0);
    setLoyaltyPage(0);
    setLoyalty(null);
    setError(null);
    setNotice(null);
  }, [customer.id]);

  useEffect(() => {
    let mounted = true;
    setPurchases(null);
    customerPurchases(customer.id, { limit: PAGE_SIZE, offset: purchasePage * PAGE_SIZE })
      .then((result) => mounted && setPurchases(result))
      .catch((failure: unknown) => mounted && setError(errorMessage(failure, "No pudimos cargar las compras.")));
    return () => {
      mounted = false;
    };
  }, [customer.id, purchasePage]);

  const loadLoyalty = useCallback(async () => {
    if (!canLoyalty) return;
    try {
      setLoyalty(await customerLoyalty(customer.id, { limit: PAGE_SIZE, offset: loyaltyPage * PAGE_SIZE }));
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos cargar los puntos."));
    }
  }, [canLoyalty, customer.id, loyaltyPage]);

  useEffect(() => {
    void loadLoyalty();
  }, [loadLoyalty]);

  useEffect(() => {
    if (!canAgreements) return undefined;
    let mounted = true;
    setAgreements(null);
    customerAgreements(customer.id)
      .then((result) => mounted && setAgreements(result.items))
      .catch(() => mounted && setAgreements([]));
    return () => {
      mounted = false;
    };
  }, [canAgreements, customer.id]);

  async function adjust(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = Number(points);
    if (!Number.isInteger(value) || value === 0) {
      setError("Escribe los puntos como un entero distinto de cero (negativo para descontar).");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adjustLoyalty(customer.id, { points: value, reason: reason.trim() });
      setPoints("");
      setReason("");
      setNotice(`Ajuste registrado. Nuevo saldo: ${result.balance} puntos.`);
      if (loyaltyPage === 0) await loadLoyalty();
      else setLoyaltyPage(0);
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos registrar el ajuste."));
    } finally {
      setSaving(false);
    }
  }

  const purchaseLast = purchases ? Math.max(0, Math.ceil(purchases.total / PAGE_SIZE) - 1) : 0;
  const loyaltyLast = loyalty ? Math.max(0, Math.ceil(loyalty.movements.total / PAGE_SIZE) - 1) : 0;
  const pointValue = loyalty ? Number(loyalty.settings.pointValueBob) : 0;

  return (
    <>
      <div className="panel-heading">
        <div><p className="section-kicker">{docLabel(customer.docType, customer.docNumber)}{customer.complement ? `-${customer.complement}` : ""}</p><h2>{customer.fullName}</h2></div>
        <button aria-label="Cerrar" className="close-action" onClick={onClose} type="button">×</button>
      </div>
      <p className="field-hint">
        {customer.phone ? `Tel. ${customer.phone}` : "Sin teléfono"} · {customer.email ?? "Sin correo"}{customer.isActive ? "" : " · Inactivo"}
        {customer.notes ? <><br />{customer.notes}</> : null}
      </p>
      <div className="user-actions"><button className="row-action" onClick={onEdit} type="button">Editar cliente</button></div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}

      {canLoyalty ? (
        <div className="payment-history">
          <p className="section-kicker">Puntos de fidelización</p>
          <div className="sales-estimate">
            <span>Saldo</span>
            <strong>{loyalty ? `${loyalty.balance} pts` : "…"}</strong>
            {loyalty ? <small>≈ {money(loyalty.balance * pointValue)} para canjear{loyalty.settings.enabled ? "" : " · el programa de puntos está desactivado"}</small> : null}
          </div>
          {canAdjust ? (
            <form className="cash-form" onSubmit={adjust}>
              <div className="procurement-field-grid">
                <label className="field"><span>Ajuste de puntos</span><input inputMode="numeric" required value={points} onChange={(event) => setPoints(event.target.value)} placeholder="Ej.: 20 o -5" /></label>
                <label className="field"><span>Motivo</span><input maxLength={200} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              </div>
              <button className="quiet-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Registrar ajuste"}</button>
            </form>
          ) : null}
          {loyalty === null ? <p className="field-hint">Cargando…</p> : loyalty.movements.items.length ? loyalty.movements.items.map((movement) => (
            <div className="payment-row" key={movement.id}>
              <div>
                <strong>{movement.points > 0 ? "+" : ""}{movement.points} pts · {loyaltyKindLabels[movement.kind]}</strong>
                <small>{formatDateTime(movement.createdAt)}{movement.saleNumber ? ` · ${movement.saleNumber}` : ""} · {movement.reason}</small>
              </div>
              <small>{movement.createdByName ?? ""}</small>
            </div>
          )) : <p className="field-hint">Aún no hay movimientos de puntos.</p>}
          {loyalty && loyalty.movements.total > PAGE_SIZE ? (
            <div className="sales-pager">
              <button className="quiet-button" disabled={loyaltyPage === 0} onClick={() => setLoyaltyPage((current) => current - 1)} type="button">← Anterior</button>
              <span>Página {loyaltyPage + 1} de {loyaltyLast + 1}</span>
              <button className="quiet-button" disabled={loyaltyPage >= loyaltyLast} onClick={() => setLoyaltyPage((current) => current + 1)} type="button">Siguiente →</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canAgreements ? (
        <div className="payment-history">
          <p className="section-kicker">Convenios</p>
          {agreements === null ? <p className="field-hint">Cargando…</p> : agreements.length ? agreements.map((agreement) => (
            <div className="payment-row" key={agreement.memberId}>
              <div><strong>{agreement.name}</strong><small>Código {agreement.memberCode} · cubre {Number(agreement.coveragePercent)}% · crédito disponible del mes: {money(agreement.remainingBob)} de {money(agreement.monthlyLimitBob)}</small></div>
            </div>
          )) : <p className="field-hint">No pertenece a ningún convenio activo.</p>}
        </div>
      ) : null}

      <div className="payment-history">
        <p className="section-kicker">Compras en esta sucursal</p>
        {purchases === null ? <p className="field-hint">Cargando…</p> : purchases.items.length ? (
          <>
            <p className="field-hint">{purchases.summary.salesCount} {purchases.summary.salesCount === 1 ? "venta" : "ventas"} · neto {money(purchases.summary.netTotalBob)} (sin anuladas, descontadas las devoluciones)</p>
            {purchases.items.map((purchase) => (
              <div className="payment-row" key={purchase.id}>
                <div>
                  <strong><Link href={`/sales/${purchase.id}`}>{purchase.number}</Link> · {money(purchase.netBob)}</strong>
                  <small>{formatDateTime(purchase.createdAt)} · {saleStatusLabels[purchase.status as SaleStatus] ?? purchase.status}{Number(purchase.refundedBob) > 0 ? ` · devuelto ${money(purchase.refundedBob)}` : ""}</small>
                </div>
              </div>
            ))}
          </>
        ) : <p className="field-hint">Sin compras registradas en esta sucursal.</p>}
        {purchases && purchases.total > PAGE_SIZE ? (
          <div className="sales-pager">
            <button className="quiet-button" disabled={purchasePage === 0} onClick={() => setPurchasePage((current) => current - 1)} type="button">← Anterior</button>
            <span>Página {purchasePage + 1} de {purchaseLast + 1}</span>
            <button className="quiet-button" disabled={purchasePage >= purchaseLast} onClick={() => setPurchasePage((current) => current + 1)} type="button">Siguiente →</button>
          </div>
        ) : null}
      </div>
    </>
  );
}
