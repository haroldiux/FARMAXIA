"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { useShellSession } from "../../components/app-shell";
import { StaffNav } from "../../components/staff-nav";
import { PeriodPicker, StaffHeader, StaffPlanRequired, useStaffAccess } from "../../components/staff-shared";
import { listCategories, listProducts, type CatalogCategory, type CatalogProductSummary } from "../../lib/catalog";
import { formatDay } from "../../components/controlled-shared";
import {
  createCommissionRule,
  createCommissionTier,
  deleteCommissionRule,
  deleteCommissionTier,
  errorMessage,
  formatBob,
  getCommissionReport,
  getMyCommissions,
  isPlanRestricted,
  listCommissionRules,
  listCommissionTiers,
  monthStartIso,
  planAllows,
  rateSourceLabels,
  ruleScopeLabels,
  todayIso,
  updateCommissionRule,
  updateCommissionTier,
  type CommissionReport,
  type CommissionRule,
  type CommissionTier,
  type RuleScope,
  type SellerCommission
} from "../../lib/staff";

function LinesTable({ seller }: Readonly<{ seller: SellerCommission }>) {
  if (!seller.lines.length) return <p className="pos-hint">Sin ventas en el período.</p>;
  return (
    <div className="controlled-table-wrap">
      <table className="invoice-table controlled-table controlled-numeric">
        <thead><tr><th>Venta</th><th>Producto</th><th>Cant.</th><th>Neto</th><th>Tasa</th><th>Comisión</th></tr></thead>
        <tbody>
          {seller.lines.map((line) => (
            <tr key={line.saleItemId}>
              <td>{line.saleNumber}<small className="controlled-sub">{formatDay(line.saleDate)}</small></td>
              <td>{line.productName}<small className="controlled-sub">{line.presentationName}</small></td>
              <td>{line.quantity}</td>
              <td>
                {formatBob(line.netBob)}
                {Number(line.returnedBob) > 0 ? <small className="controlled-sub">Devuelto {formatBob(line.returnedBob)} de {formatBob(line.lineTotalBob)}</small> : null}
              </td>
              <td>{Number(line.ratePercent).toFixed(2)}%<small className="controlled-sub">{rateSourceLabels[line.rateSource]}</small></td>
              <td>{formatBob(line.commissionBob)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Comisiones propias del período (cualquier miembro). */
function MyCommissions({ from, to, onRestricted }: Readonly<{ from: string; to: string; onRestricted: () => void }>) {
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    getMyCommissions(from, to)
      .then((value) => mounted && setReport(value))
      .catch((reason) => {
        if (!mounted) return;
        setReport(null);
        if (isPlanRestricted(reason)) onRestricted();
        else setError(errorMessage(reason, "No pudimos cargar tus comisiones."));
      });
    return () => {
      mounted = false;
    };
  }, [from, to, onRestricted]);

  const mine = report?.sellers[0];
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">{formatDay(from)} – {formatDay(to)}</p><h2>Mis comisiones</h2></div>
        <span className="panel-count">{report ? formatBob(report.totalCommissionBob) : "—"}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {!report && !error ? <p className="pos-hint">Cargando…</p> : null}
      {report && !mine ? (
        <div className="procurement-empty">
          <span className="empty-symbol">✦</span>
          <h3>Sin ventas en este período.</h3>
          <p>Tus comisiones aparecen cuando registras ventas en el punto de venta.</p>
        </div>
      ) : null}
      {mine ? (
        <>
          <dl className="controlled-details">
            <div><dt>Ventas netas</dt><dd>{formatBob(mine.netSalesBob)}</dd></div>
            <div><dt>Comisión total</dt><dd>{formatBob(mine.commissionBob)}</dd></div>
            {report?.multilevelApplied ? <div><dt>Nivel alcanzado</dt><dd>{mine.tierRatePercent ? `${Number(mine.tierRatePercent).toFixed(2)}%` : "Ninguno"}</dd></div> : null}
          </dl>
          <LinesTable seller={mine} />
        </>
      ) : null}
    </section>
  );
}

/** Reporte de la sucursal por vendedor, con detalle por línea (staff.reports.read). */
function TeamReport({ from, to }: Readonly<{ from: string; to: string }>) {
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setError(null);
    getCommissionReport(from, to)
      .then((value) => mounted && setReport(value))
      .catch((reason) => {
        if (!mounted) return;
        setReport(null);
        setError(errorMessage(reason, "No pudimos cargar el reporte de comisiones."));
      });
    return () => {
      mounted = false;
    };
  }, [from, to]);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">{formatDay(from)} – {formatDay(to)}</p><h2>Comisiones por vendedor</h2></div>
        <span className="panel-count">{report ? formatBob(report.totalCommissionBob) : "—"}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {!report && !error ? <p className="pos-hint">Cargando…</p> : null}
      {report && !report.sellers.length ? (
        <div className="procurement-empty">
          <span className="empty-symbol">✦</span>
          <h3>Sin ventas en este período.</h3>
          <p>Elige otro rango de fechas.</p>
        </div>
      ) : null}
      {report?.sellers.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table controlled-numeric">
            <thead><tr><th>Vendedor</th><th>Ventas netas</th>{report.multilevelApplied ? <th>Nivel</th> : null}<th>Comisión</th><th /></tr></thead>
            <tbody>
              {report.sellers.map((seller) => (
                <Fragment key={seller.userId}>
                  <tr>
                    <td>{seller.userName}</td>
                    <td>{formatBob(seller.netSalesBob)}</td>
                    {report.multilevelApplied ? <td>{seller.tierRatePercent ? `${Number(seller.tierRatePercent).toFixed(2)}%` : "—"}</td> : null}
                    <td>{formatBob(seller.commissionBob)}</td>
                    <td><button className="row-action" onClick={() => setOpen(open === seller.userId ? null : seller.userId)} type="button">{open === seller.userId ? "Ocultar detalle" : "Ver detalle"}</button></td>
                  </tr>
                  {open === seller.userId ? <tr><td colSpan={report.multilevelApplied ? 5 : 4}><LinesTable seller={seller} /></td></tr> : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="field-hint">Base: importe de la línea menos lo devuelto; las ventas anuladas no comisionan. Prioridad de tasa: producto, categoría, general{report?.multilevelApplied ? " y nivel por ventas si es mayor" : ""}.</p>
    </section>
  );
}

/** Reglas de comisión: general, por categoría o por producto (staff.commissions.manage). */
function RulesPanel() {
  const [rules, setRules] = useState<CommissionRule[] | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProductSummary[]>([]);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<RuleScope>("DEFAULT");
  const [targetId, setTargetId] = useState("");
  const [rate, setRate] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await listCommissionRules());
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar las reglas."));
    }
  }, []);

  useEffect(() => {
    void load();
    listCategories().then((items) => setCategories(items.filter((item) => item.isActive))).catch(() => setCategories([]));
  }, [load]);

  useEffect(() => {
    if (scope !== "PRODUCT" || search.trim().length < 2) {
      setProducts([]);
      return;
    }
    let mounted = true;
    const timer = setTimeout(() => {
      listProducts({ search, limit: 20 }).then((result) => mounted && setProducts(result.items)).catch(() => mounted && setProducts([]));
    }, 250);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [scope, search]);

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (reason) {
      setError(errorMessage(reason, failure));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await run(
      async () => {
        await createCommissionRule({ scope, targetId: scope === "DEFAULT" ? null : targetId, ratePercent: Number(rate) });
        setRate("");
        setTargetId("");
      },
      "Regla creada.",
      "No pudimos crear la regla."
    );
    setSaving(false);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">Administración</p><h2>Reglas de comisión</h2></div>
        <span className="panel-count">{(rules?.length ?? 0).toString().padStart(2, "0")}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {message ? <p className="form-success procurement-message" role="status">{message}</p> : null}
      {rules && !rules.length ? <p className="pos-hint">Aún no hay reglas: sin una regla general las ventas no generan comisión.</p> : null}
      {rules?.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table">
            <thead><tr><th>Alcance</th><th>Objetivo</th><th>Tasa (%)</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rules.map((rule) => {
                const draft = drafts[rule.id] ?? Number(rule.ratePercent).toFixed(2);
                return (
                  <tr key={rule.id}>
                    <td>{ruleScopeLabels[rule.scope]}</td>
                    <td>{rule.targetName ?? "Todos los productos"}</td>
                    <td>
                      <input aria-label="Tasa de comisión" className="staff-rate-input" max="100" min="0" step="0.01" type="number" value={draft} onChange={(event) => setDrafts({ ...drafts, [rule.id]: event.target.value })} />
                    </td>
                    <td><span className={`order-status ${rule.isActive ? "sale-confirmed" : "quote-expired"}`}>{rule.isActive ? "Activa" : "Inactiva"}</span></td>
                    <td className="staff-actions">
                      <button className="row-action" disabled={draft === Number(rule.ratePercent).toFixed(2)} onClick={() => void run(() => updateCommissionRule(rule.id, { ratePercent: Number(draft) }), "Tasa actualizada.", "No pudimos actualizar la regla.")} type="button">Guardar tasa</button>
                      <button className="row-action row-action-muted" onClick={() => void run(() => updateCommissionRule(rule.id, { isActive: !rule.isActive }), rule.isActive ? "Regla desactivada." : "Regla activada.", "No pudimos actualizar la regla.")} type="button">{rule.isActive ? "Desactivar" : "Activar"}</button>
                      <button className="row-action row-action-danger" onClick={() => void run(() => deleteCommissionRule(rule.id), "Regla eliminada.", "No pudimos eliminar la regla.")} type="button">Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <h3 className="controlled-subtitle">Nueva regla</h3>
      <form className="procurement-form staff-form" onSubmit={submit}>
        <label className="field">
          <span>Alcance</span>
          <select value={scope} onChange={(event) => { setScope(event.target.value as RuleScope); setTargetId(""); setSearch(""); }}>
            {(Object.keys(ruleScopeLabels) as RuleScope[]).map((value) => <option key={value} value={value}>{ruleScopeLabels[value]}</option>)}
          </select>
        </label>
        {scope === "CATEGORY" ? (
          <label className="field">
            <span>Categoría</span>
            <select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">Selecciona una categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        ) : null}
        {scope === "PRODUCT" ? (
          <>
            <label className="field"><span>Buscar producto</span><input placeholder="Mínimo 2 letras" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            <label className="field">
              <span>Producto</span>
              <select required value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">{products.length ? "Selecciona un producto" : "Busca un producto primero"}</option>
                {products.map((product) => <option key={product.productId} value={product.productId}>{product.name}</option>)}
              </select>
            </label>
          </>
        ) : null}
        <label className="field"><span>Tasa de comisión (%)</span><input max="100" min="0" required step="0.01" type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
        <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Crear regla"}<span>↗</span></button>
      </form>
    </section>
  );
}

/** Niveles por ventas del período (solo Premium; staff.commissions.manage). */
function TiersPanel() {
  const [tiers, setTiers] = useState<CommissionTier[] | null>(null);
  const [minSales, setMinSales] = useState("");
  const [rate, setRate] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setTiers(await listCommissionTiers());
    } catch (reason) {
      setError(errorMessage(reason, "No pudimos cargar los niveles."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (reason) {
      setError(errorMessage(reason, failure));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await run(
      async () => {
        await createCommissionTier({ minNetSalesBob: Number(minSales), ratePercent: Number(rate) });
        setMinSales("");
        setRate("");
      },
      "Nivel creado.",
      "No pudimos crear el nivel."
    );
    setSaving(false);
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="section-kicker">Plan Premium</p><h2>Niveles por ventas</h2></div>
        <span className="panel-count">{(tiers?.length ?? 0).toString().padStart(2, "0")}</span>
      </div>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {message ? <p className="form-success procurement-message" role="status">{message}</p> : null}
      {tiers && !tiers.length ? <p className="pos-hint">Aún no hay niveles.</p> : null}
      {tiers?.length ? (
        <div className="controlled-table-wrap">
          <table className="invoice-table controlled-table">
            <thead><tr><th>Ventas netas desde (Bs)</th><th>Tasa (%)</th><th /></tr></thead>
            <tbody>
              {tiers.map((tier) => {
                const draft = drafts[tier.id] ?? Number(tier.ratePercent).toFixed(2);
                return (
                  <tr key={tier.id}>
                    <td>{formatBob(tier.minNetSalesBob)}</td>
                    <td><input aria-label="Tasa del nivel" className="staff-rate-input" max="100" min="0" step="0.01" type="number" value={draft} onChange={(event) => setDrafts({ ...drafts, [tier.id]: event.target.value })} /></td>
                    <td className="staff-actions">
                      <button className="row-action" disabled={draft === Number(tier.ratePercent).toFixed(2)} onClick={() => void run(() => updateCommissionTier(tier.id, { ratePercent: Number(draft) }), "Nivel actualizado.", "No pudimos actualizar el nivel.")} type="button">Guardar tasa</button>
                      <button className="row-action row-action-danger" onClick={() => void run(() => deleteCommissionTier(tier.id), "Nivel eliminado.", "No pudimos eliminar el nivel.")} type="button">Eliminar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <h3 className="controlled-subtitle">Nuevo nivel</h3>
      <form className="procurement-form staff-form" onSubmit={submit}>
        <label className="field"><span>Ventas netas del período desde (Bs)</span><input min="0" required step="0.01" type="number" value={minSales} onChange={(event) => setMinSales(event.target.value)} /></label>
        <label className="field"><span>Tasa de comisión (%)</span><input max="100" min="0" required step="0.01" type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
        <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Crear nivel"}<span>↗</span></button>
      </form>
      <p className="field-hint">Si las ventas netas de la persona en el período alcanzan un nivel, su tasa reemplaza a la de la regla cuando es mayor.</p>
    </section>
  );
}

/** Comisiones: las propias (todos), el reporte del equipo y la administración de reglas y niveles. */
export default function StaffCommissionsPage() {
  const access = useStaffAccess();
  const shell = useShellSession();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [restricted, setRestricted] = useState(false);
  const markRestricted = useCallback(() => setRestricted(true), []);

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando comisiones…</main>;
  const permissions = access.session.permissions;
  const canReport = permissions.includes("staff.reports.read");
  const canManage = permissions.includes("staff.commissions.manage");
  const multilevel = planAllows(shell?.subscription?.features, "staff.commissions.multilevel");

  return (
    <main className="procurement-page controlled-page">
      <StaffHeader kicker="Personal · Comisiones" title="Comisiones de venta." lede="Revisa tus comisiones del período y, si administras al equipo, el reporte por vendedor y las reglas de cálculo." />
      <StaffNav />
      {restricted ? <StaffPlanRequired what="Las comisiones" /> : (
        <>
          <section className="panel"><PeriodPicker from={from} to={to} onChange={(nextFrom, nextTo) => { setFrom(nextFrom); setTo(nextTo); }} /></section>
          {from && to && from <= to ? (
            <>
              <MyCommissions from={from} onRestricted={markRestricted} to={to} />
              {canReport ? <TeamReport from={from} to={to} /> : null}
            </>
          ) : <p className="form-error procurement-message" role="alert">Indica un período válido.</p>}
          {canManage ? <RulesPanel /> : null}
          {canManage ? (multilevel ? <TiersPanel /> : <StaffPlanRequired plan="Premium" what="Los niveles de comisión por ventas" />) : null}
        </>
      )}
    </main>
  );
}
