"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CustomersNav } from "../../components/customers-nav";
import { CrmDenied, CrmHeader, CrmPlanRequired, useCrmSession } from "../../components/customers-shared";
import {
  currentMonth,
  errorMessage,
  formatDay,
  isPlanRestricted,
  issueStatement,
  listAgreements,
  listStatements,
  money,
  planAllows,
  previewStatement,
  statementStatusLabels,
  type Agreement,
  type Paged,
  type StatementPreview,
  type StatementStatus,
  type StatementSummary
} from "../../lib/customers";

const PAGE_SIZE = 20;
const statusClass: Record<StatementStatus, string> = { ISSUED: "quote-expired", PARTIAL: "sale-partially_returned", PAID: "sale-confirmed" };

/** Monthly statements per agreement (agreements.billing): preview the open charges, issue, and follow payments. */
export default function StatementsPage() {
  const router = useRouter();
  const { session, features } = useCrmSession();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [agreementId, setAgreementId] = useState("");
  const [period, setPeriod] = useState(currentMonth());
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [list, setList] = useState<Paged<StatementSummary> | null>(null);
  const [filterAgreement, setFilterAgreement] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatementStatus | "">("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);

  const allowed = session?.permissions.includes("agreements.billing") ?? false;
  const planKnown = features !== undefined;
  const planOk = planAllows(features, "crm.agreements");
  const ready = allowed && planKnown && planOk;

  useEffect(() => {
    if (!ready) return undefined;
    let mounted = true;
    listAgreements({ limit: 200 })
      .then((result) => mounted && setAgreements(result.items))
      .catch((failure: unknown) => {
        if (!mounted) return;
        if (isPlanRestricted(failure)) setRestricted(true);
        else setError(errorMessage(failure, "No pudimos cargar los convenios."));
      });
    return () => {
      mounted = false;
    };
  }, [ready]);

  const loadList = useCallback(async () => {
    try {
      setList(await listStatements({ agreementId: filterAgreement || undefined, status: filterStatus, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
    } catch (failure) {
      if (isPlanRestricted(failure)) setRestricted(true);
      else setError(errorMessage(failure, "No pudimos cargar los estados de cuenta."));
    }
  }, [filterAgreement, filterStatus, page]);

  useEffect(() => {
    if (ready) void loadList();
  }, [ready, loadList]);

  // A preview belongs to the agreement and month it was asked for.
  useEffect(() => setPreview(null), [agreementId, period]);

  async function runPreview(): Promise<void> {
    if (!agreementId) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewStatement(agreementId, period));
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos calcular la vista previa."));
    } finally {
      setBusy(false);
    }
  }

  async function issue(): Promise<void> {
    if (!agreementId) return;
    setBusy(true);
    setError(null);
    try {
      const statement = await issueStatement(agreementId, period);
      router.push(`/customers/statements/${statement.id}`);
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos emitir el estado de cuenta."));
      setBusy(false);
    }
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!allowed) return <CrmDenied />;

  const total = list?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <main className="procurement-page">
      <CrmHeader kicker="Clientes · Estados de cuenta" title="Cobra cada convenio una vez al mes." lede="Reúne los cargos abiertos de todas las sucursales en un estado de cuenta mensual, imprímelo o descárgalo en CSV y registra los pagos de la entidad. No es una factura fiscal." />
      <CustomersNav />
      {!planOk || restricted ? <CrmPlanRequired plan="Premium" what="Los estados de cuenta de convenios" /> : (
        <>
          {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}

          <section className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Nuevo estado de cuenta</p><h2>Elige convenio y mes</h2></div></div>
            <div className="controlled-filters">
              <label className="inventory-filter"><span>Convenio</span>
                <select value={agreementId} onChange={(event) => setAgreementId(event.target.value)}>
                  <option value="">Selecciona un convenio</option>
                  {agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.name}{agreement.isActive ? "" : " (inactivo)"}</option>)}
                </select>
              </label>
              <label className="inventory-filter"><span>Mes</span><input max={currentMonth()} type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
              <button className="quiet-button" disabled={!agreementId || busy} onClick={() => void runPreview()} type="button">Ver cargos del mes</button>
            </div>
            {preview ? (
              <>
                <div className="sales-estimate">
                  <span>{preview.agreementName} · {preview.period}</span>
                  <strong>{money(preview.totalBob)}</strong>
                  <small>{preview.lineCount} {preview.lineCount === 1 ? "cargo abierto" : "cargos abiertos"} de todas las sucursales</small>
                </div>
                {preview.lines.length ? (
                  <div className="sales-table-wrap">
                    <table className="sales-table">
                      <thead><tr><th>Venta</th><th>Sucursal</th><th>Fecha</th><th>Afiliado</th><th>Monto</th></tr></thead>
                      <tbody>
                        {preview.lines.map((line) => (
                          <tr key={line.chargeId}><td>{line.saleNumber}</td><td>{line.branchCode}</td><td>{formatDay(line.saleDate)}</td><td>{line.customerName} · {line.memberCode}</td><td className="sales-amount">{money(line.amountBob)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="field-hint">No hay cargos abiertos en este periodo.</p>}
                <div className="user-actions">
                  <button className="primary-button" disabled={busy || preview.lineCount === 0} onClick={() => void issue()} type="button">{busy ? "Emitiendo…" : "Emitir estado de cuenta"}<span>↗</span></button>
                </div>
                <p className="field-hint">Al emitir, los cargos quedan facturados y ya no se pueden anular ni devolver. Hay un estado de cuenta por convenio y mes.</p>
              </>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Emitidos</p><h2>{total} {total === 1 ? "estado de cuenta" : "estados de cuenta"}</h2></div></div>
            <div className="controlled-filters">
              <label className="inventory-filter"><span>Convenio</span>
                <select value={filterAgreement} onChange={(event) => { setFilterAgreement(event.target.value); setPage(0); }}>
                  <option value="">Todos</option>
                  {agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.name}</option>)}
                </select>
              </label>
              <label className="inventory-filter"><span>Estado</span>
                <select value={filterStatus} onChange={(event) => { setFilterStatus(event.target.value as StatementStatus | ""); setPage(0); }}>
                  <option value="">Todos</option>
                  {(Object.keys(statementStatusLabels) as StatementStatus[]).map((status) => <option key={status} value={status}>{statementStatusLabels[status]}</option>)}
                </select>
              </label>
            </div>
            {list === null ? <div className="inventory-state"><span className="loading-orb" />Cargando…</div> : list.items.length ? (
              <div className="sales-table-wrap">
                <table className="sales-table">
                  <thead><tr><th>Número</th><th>Convenio</th><th>Periodo</th><th>Estado</th><th>Total</th><th>Saldo</th><th /></tr></thead>
                  <tbody>
                    {list.items.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.number}</strong></td>
                        <td>{item.agreementName}</td>
                        <td>{item.period}</td>
                        <td><span className={`order-status ${statusClass[item.status]}`}>{statementStatusLabels[item.status]}</span></td>
                        <td className="sales-amount">{money(item.totalBob)}</td>
                        <td className="sales-amount">{money(item.balanceBob)}</td>
                        <td><Link className="row-action" href={`/customers/statements/${item.id}`}>Ver detalle</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="catalog-empty"><span>✓</span><h3>No hay estados de cuenta con estos filtros.</h3><p>Emite el primero arriba.</p></div>}
            {total > PAGE_SIZE ? (
              <div className="sales-pager">
                <button className="quiet-button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">← Anterior</button>
                <span>Página {page + 1} de {lastPage + 1}</span>
                <button className="quiet-button" disabled={page >= lastPage} onClick={() => setPage((current) => current + 1)} type="button">Siguiente →</button>
              </div>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
