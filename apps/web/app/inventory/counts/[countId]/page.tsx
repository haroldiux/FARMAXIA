"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { InventoryNav } from "../../../components/inventory-nav";
import { countAction, countStatusLabels, getCount, recordCountLines, type CountDetail } from "../../../lib/inventory";
import { currentSession } from "../../../lib/session";

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CountDetailPage() {
  const { countId } = useParams<{ countId: string }>();
  const [count, setCount] = useState<CountDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [canApprove, setCanApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((detail: CountDetail) => {
    setCount(detail);
    setDraft(Object.fromEntries(detail.lines.map((line) => [line.batchId, line.countedQuantity === null ? "" : String(line.countedQuantity)])));
  }, []);

  useEffect(() => {
    getCount(countId).then(show).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar el conteo."));
    currentSession().then((session) => setCanApprove(session.permissions.includes("inventory.count.approve"))).catch(() => undefined);
  }, [countId, show]);

  function changedLines(): Array<{ batchId: string; countedQuantity: number | null }> | null {
    if (!count) return [];
    const lines: Array<{ batchId: string; countedQuantity: number | null }> = [];
    for (const line of count.lines) {
      const raw = (draft[line.batchId] ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        setError(`La cantidad del lote ${line.lotCode} debe ser un entero de 0 o más.`);
        return null;
      }
      if (value !== line.countedQuantity) lines.push({ batchId: line.batchId, countedQuantity: value });
    }
    return lines;
  }

  async function run(action: () => Promise<CountDetail>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      show(await action());
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos actualizar el conteo.");
    } finally {
      setBusy(false);
    }
  }

  function save(): void {
    const lines = changedLines();
    if (!lines || !count) return;
    if (!lines.length) {
      setNotice("No hay cambios por guardar.");
      return;
    }
    void run(() => recordCountLines(count.id, lines), "Cantidades guardadas.");
  }

  function submit(): void {
    const lines = changedLines();
    if (!lines || !count) return;
    if (!window.confirm("¿Enviar el conteo a revisión? Ya no podrás cambiar las cantidades.")) return;
    void run(async () => {
      if (lines.length) await recordCountLines(count.id, lines);
      return countAction(count.id, "submit");
    }, "Conteo enviado a revisión: ya se ven las diferencias.");
  }

  if (!count) {
    return <main className="center-state">{error ? <p className="form-error" role="alert">{error}</p> : <><span className="loading-orb" />Cargando conteo…</>}</main>;
  }

  const open = count.status === "OPEN";
  const pending = count.lines.filter((line) => (draft[line.batchId] ?? "").trim() === "").length;
  const totals = count.lines.reduce(
    (sum, line) => ({ over: sum.over + Math.max(line.difference ?? 0, 0), under: sum.under + Math.min(line.difference ?? 0, 0) }),
    { over: 0, under: 0 }
  );

  return (
    <main className="inventory-page">
      <header className="inventory-header">
        <div>
          <Link className="back-link" href="/inventory/counts">← Volver a inventario físico</Link>
          <p className="eyebrow">Conteo {count.number}</p>
          <h1>{count.warehouseName}</h1>
          <p className="inventory-lede">
            <span className={`order-status count-${count.status.toLowerCase()}`}>{countStatusLabels[count.status]}</span>{" "}
            {count.lineCount} lotes{count.notes ? ` · ${count.notes}` : ""}{count.createdByName ? ` · abierto por ${count.createdByName}` : ""}
          </p>
        </div>
      </header>
      <InventoryNav />
      {error ? <p className="form-error inventory-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success inventory-message" role="status">{notice}</p> : null}

      <section className="panel count-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">{open ? "Conteo ciego" : "Revisión de diferencias"}</p>
            <h2>{open ? "Anota lo que hay en el estante" : "Sistema contra conteo"}</h2>
          </div>
          {open ? <span className="panel-count">{pending.toString().padStart(2, "0")}</span> : null}
        </div>
        {open ? <p className="field-hint">El stock del sistema está oculto hasta enviar el conteo. Faltan {pending} lotes por contar.</p> : null}
        {count.lines.length ? (
          <div className="count-table" role="table">
            <div className={`count-head ${open ? "is-blind" : ""}`} role="row">
              <span>Producto</span><span>Lote</span><span>Vence</span><span>Contado</span>{open ? null : <><span>Sistema</span><span>Diferencia</span></>}
            </div>
            {count.lines.map((line) => (
              <div className={`count-line ${open ? "is-blind" : ""} ${line.difference ? "has-difference" : ""}`} key={line.batchId} role="row">
                <div><strong>{line.productName}</strong><small>{line.presentationName}</small></div>
                <span data-label="Lote">{line.lotCode}</span>
                <span data-label="Vence">{formatDate(line.expiresOn)}</span>
                {open ? (
                  <span className="count-input" data-label="Contado"><input aria-label={`Cantidad contada del lote ${line.lotCode}`} inputMode="numeric" min="0" type="number" value={draft[line.batchId] ?? ""} onChange={(event) => setDraft({ ...draft, [line.batchId]: event.target.value })} placeholder="—" /></span>
                ) : <strong data-label="Contado">{line.countedQuantity ?? "—"}</strong>}
                {open ? null : (
                  <>
                    <span data-label="Sistema">{line.expectedQuantity ?? "—"}</span>
                    <strong data-label="Diferencia" className={line.difference ? (line.difference > 0 ? "diff-over" : "diff-under") : "diff-zero"}>
                      {line.difference === null ? "—" : line.difference > 0 ? `+${line.difference}` : line.difference}
                    </strong>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : <div className="catalog-empty"><span>✦</span><h3>El almacén no tenía lotes con stock.</h3><p>Puedes anular este conteo.</p></div>}

        {!open && count.status === "SUBMITTED" ? (
          <p className="field-hint">Sobrantes: +{totals.over} · Faltantes: {totals.under}. Al aprobar se ajusta el stock actual de cada lote a lo contado (queda en Auditoría).</p>
        ) : null}

        <div className="count-actions">
          {open ? (
            <>
              <button className="quiet-button" disabled={busy} onClick={save} type="button">Guardar avance</button>
              <button className="primary-button" disabled={busy} onClick={submit} type="button">Enviar a revisión<span aria-hidden="true">↗</span></button>
            </>
          ) : null}
          {count.status === "SUBMITTED" ? (
            canApprove ? (
              <button className="primary-button" disabled={busy} onClick={() => {
                if (window.confirm("¿Aprobar el conteo y ajustar el inventario?")) void run(() => countAction(count.id, "approve"), "Conteo aprobado: el inventario quedó ajustado.");
              }} type="button">Aprobar y ajustar<span aria-hidden="true">✓</span></button>
            ) : <p className="field-hint">Un usuario con permiso «Aprobar conteos de inventario» debe aprobarlo.</p>
          ) : null}
          {open || count.status === "SUBMITTED" ? (
            <button className="row-action row-action-danger" disabled={busy} onClick={() => {
              if (window.confirm("¿Anular este conteo? No se ajustará nada.")) void run(() => countAction(count.id, "cancel"), "Conteo anulado.");
            }} type="button">Anular conteo</button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
