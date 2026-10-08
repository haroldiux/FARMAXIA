"use client";

import { type FormEvent, useEffect, useState } from "react";
import { CustomersNav } from "../../components/customers-nav";
import { CrmDenied, CrmHeader, CrmPlanRequired, useCrmSession } from "../../components/customers-shared";
import { errorMessage, getLoyaltySettings, isPlanRestricted, money, planAllows, updateLoyaltySettings } from "../../lib/customers";

const decimalPattern = /^\d{1,10}(?:\.\d{1,4})?$/;

/** Loyalty program settings (owner only, loyalty.manage): BOB per point earned and BOB value of a point. */
export default function LoyaltySettingsPage() {
  const { session, features } = useCrmSession();
  const [enabled, setEnabled] = useState(true);
  const [bobPerPoint, setBobPerPoint] = useState("");
  const [pointValue, setPointValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allowed = session?.permissions.includes("loyalty.manage") ?? false;
  const planKnown = features !== undefined;
  const planOk = planAllows(features, "crm.loyalty");

  useEffect(() => {
    if (!allowed || !planKnown || !planOk) return undefined;
    let mounted = true;
    getLoyaltySettings()
      .then((settings) => {
        if (!mounted) return;
        setEnabled(settings.enabled);
        setBobPerPoint(Number(settings.bobPerPoint).toString());
        setPointValue(Number(settings.pointValueBob).toString());
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (!mounted) return;
        if (isPlanRestricted(failure)) setRestricted(true);
        else setError(errorMessage(failure, "No pudimos cargar la configuración de puntos."));
      });
    return () => {
      mounted = false;
    };
  }, [allowed, planKnown, planOk]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!decimalPattern.test(bobPerPoint.trim()) || Number(bobPerPoint) <= 0 || !decimalPattern.test(pointValue.trim()) || Number(pointValue) <= 0) {
      setError("Escribe montos mayores a cero con hasta 4 decimales.");
      return;
    }
    setSaving(true);
    try {
      const saved = await updateLoyaltySettings({ enabled, bobPerPoint: bobPerPoint.trim(), pointValueBob: pointValue.trim() });
      setBobPerPoint(Number(saved.bobPerPoint).toString());
      setPointValue(Number(saved.pointValueBob).toString());
      setNotice("Configuración guardada. Aplica a las próximas ventas.");
    } catch (failure) {
      setError(errorMessage(failure, "No pudimos guardar la configuración."));
    } finally {
      setSaving(false);
    }
  }

  if (!session) return <main className="center-state"><span className="loading-orb" />Cargando…</main>;
  if (!allowed) return <CrmDenied />;

  return (
    <main className="procurement-page">
      <CrmHeader kicker="Clientes · Puntos" title="Premia a tus clientes frecuentes." lede="Define cuánto debe pagar un cliente para ganar un punto y cuánto vale cada punto al canjearlo en el POS." />
      <CustomersNav />
      {!planOk || restricted ? <CrmPlanRequired plan="Profesional" what="El programa de puntos" /> : (
        <section className="panel">
          <div className="panel-heading"><div><p className="section-kicker">Programa de puntos</p><h2>Reglas de acumulación y canje</h2></div></div>
          {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
          {notice ? <p className="form-success procurement-message" role="status">{notice}</p> : null}
          {!loaded && !error ? <p className="pos-hint">Cargando…</p> : (
            <form className="cash-form" onSubmit={save}>
              <label className="field"><span><input checked={enabled} type="checkbox" onChange={(event) => setEnabled(event.target.checked)} /> Programa de puntos activo</span></label>
              <div className="procurement-field-grid">
                <label className="field"><span>Bs pagados por cada punto ganado</span><input inputMode="decimal" required value={bobPerPoint} onChange={(event) => setBobPerPoint(event.target.value)} /></label>
                <label className="field"><span>Valor de un punto al canjear (Bs)</span><input inputMode="decimal" required value={pointValue} onChange={(event) => setPointValue(event.target.value)} /></label>
              </div>
              <p className="field-hint">
                Ejemplo: con estos valores, una venta de Bs 100 pagada en efectivo, tarjeta o QR gana {Number(bobPerPoint) > 0 ? Math.floor(100 / Number(bobPerPoint)) : "—"} puntos, y 100 puntos equivalen a {money(100 * (Number(pointValue) || 0))}. Los pagos con puntos o convenio no ganan puntos.
              </p>
              <button className="primary-button" disabled={saving} type="submit">{saving ? "Guardando…" : "Guardar configuración"}<span>↗</span></button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
