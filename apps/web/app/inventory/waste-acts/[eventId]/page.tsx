"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { disposalMethodLabels, getWasteAct, type WasteActDocument } from "../../../lib/inventory";

function formatDate(value: string): string {
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("es-BO", { day: "2-digit", month: "long", year: "numeric" });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
}

/** Acta de baja imprimible (formato provisional, ver D38). */
export default function WasteActPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [act, setAct] = useState<WasteActDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWasteAct(eventId).then(setAct).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "No pudimos cargar el acta."));
  }, [eventId]);

  if (!act) {
    return <main className="center-state">{error ? <p className="form-error" role="alert">{error}</p> : <><span className="loading-orb" />Cargando acta…</>}</main>;
  }

  return (
    <main className="act-page">
      <div className="act-toolbar no-print">
        <Link className="back-link" href="/inventory/waste-acts">← Volver a actas de baja</Link>
        <button className="primary-button" onClick={() => window.print()} type="button">Imprimir acta<span aria-hidden="true">⎙</span></button>
      </div>

      <article className="act-document">
        <header className="act-heading">
          <div>
            <strong>{act.legalName}</strong>
            <span>NIT {act.taxId}</span>
            <span>Sucursal {act.branchCode} · {act.branchName}</span>
          </div>
          <div className="act-number">
            <span>Acta de baja</span>
            <strong>{act.actNumber ?? "S/N"}</strong>
          </div>
        </header>

        <h1>ACTA DE BAJA DE PRODUCTOS FARMACÉUTICOS</h1>
        <p>
          En fecha {formatDate(act.createdAt)}, a horas {formatTime(act.createdAt)}, en el almacén «{act.warehouseName}» de la sucursal
          {" "}{act.branchName}, se procede a dar de baja del inventario el producto que se detalla a continuación:
        </p>

        <table className="act-table">
          <thead>
            <tr><th>Producto</th><th>Presentación</th><th>Lote</th><th>Vencimiento</th><th>Cantidad</th><th>Costo unit. (Bs)</th><th>Total (Bs)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{act.productName}</td>
              <td>{act.presentationName}</td>
              <td>{act.lotCode}</td>
              <td>{formatDate(act.expiresOn)}</td>
              <td>{act.quantityBase}</td>
              <td>{act.unitCost}</td>
              <td>{act.totalCost}</td>
            </tr>
          </tbody>
        </table>

        <dl className="act-facts">
          <div><dt>Motivo</dt><dd>{act.reason}</dd></div>
          <div><dt>Destino del producto</dt><dd>{act.disposalMethod ? disposalMethodLabels[act.disposalMethod] : "No indicado"}</dd></div>
          <div><dt>Registrado por</dt><dd>{act.createdByName ?? "—"}</dd></div>
        </dl>

        <p>La baja quedó registrada en el sistema FARMAXIA y descontada del inventario. En constancia firman:</p>

        <div className="act-signatures">
          <div><span />Responsable de almacén</div>
          <div><span />Regente farmacéutico</div>
          <div><span />Testigo</div>
        </div>
      </article>
    </main>
  );
}
