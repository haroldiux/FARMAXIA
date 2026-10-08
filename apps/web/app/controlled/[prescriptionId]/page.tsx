"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ControlledDenied, ControlledHeader, formatDateTime, formatDay, useControlledAccess } from "../../components/controlled-shared";
import { ControlledNav } from "../../components/controlled-nav";
import { getPrescription, type Prescription } from "../../lib/controlled";

/** Detalle de una receta archivada: datos del médico y paciente y lo dispensado por lote. */
export default function PrescriptionDetailPage() {
  const { prescriptionId } = useParams<{ prescriptionId: string }>();
  const access = useControlledAccess();
  const [item, setItem] = useState<Prescription | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (access.status !== "ready") return;
    let mounted = true;
    getPrescription(prescriptionId)
      .then((value) => mounted && setItem(value))
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : "No pudimos cargar la receta."));
    return () => {
      mounted = false;
    };
  }, [access.status, prescriptionId]);

  if (access.status === "loading") return <main className="center-state"><span className="loading-orb" />Cargando receta…</main>;
  if (access.status === "denied") return <ControlledDenied />;

  return (
    <main className="procurement-page controlled-page">
      <ControlledHeader kicker="Controlados · Receta" title={item ? `Receta ${item.folio}` : "Detalle de la receta"} lede="Datos archivados al momento de la venta; no se pueden modificar." />
      <ControlledNav />
      <Link className="back-link" href="/controlled">← Volver al archivo</Link>
      {error ? <p className="form-error procurement-message" role="alert">{error}</p> : null}
      {!item && !error ? <p className="pos-hint">Cargando…</p> : null}
      {item ? (
        <>
          <section className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Receta</p><h2>{item.folio}</h2></div></div>
            <dl className="controlled-details">
              <div><dt>Venta</dt><dd>{item.saleNumber}</dd></div>
              <div><dt>Dispensación</dt><dd>{formatDateTime(item.createdAt)}</dd></div>
              <div><dt>Fecha de la receta</dt><dd>{formatDay(item.prescribedAt)}</dd></div>
              <div><dt>Médico</dt><dd>{item.doctorName} · Mat. {item.doctorLicense}</dd></div>
              <div><dt>Paciente</dt><dd>{item.patientName} · {item.patientDocument}</dd></div>
              <div><dt>Centro de salud emisor</dt><dd>{item.issuingCenter}</dd></div>
              {item.notes ? <div><dt>Notas</dt><dd>{item.notes}</dd></div> : null}
            </dl>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Dispensado</p><h2>Productos de la venta</h2></div></div>
            <div className="controlled-table-wrap">
              <table className="invoice-table controlled-table">
                <thead><tr><th>Producto</th><th>Presentación</th><th>Cantidad</th><th>Unidades base</th><th>Lotes</th></tr></thead>
                <tbody>
                  {item.items.map((line, index) => (
                    <tr key={index}>
                      <td>{line.productName}{line.isControlled ? <em className="controlled-badge">Controlado</em> : null}</td>
                      <td>{line.presentationName}</td>
                      <td>{line.quantity}</td>
                      <td>{line.quantityBase}</td>
                      <td>{line.lots.length ? line.lots.map((lot) => `${lot.lotCode} (${lot.quantityBase} u.)`).join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
