import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";
import { DocumentSequenceService } from "../transversal/document-sequence.service.js";

/** Prescription data captured at the POS when a sale dispenses a controlled product. */
export interface ControlledPrescriptionInput {
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  /** Prescription date, YYYY-MM-DD. */
  prescribedAt: string;
  notes?: string;
}

export interface NormalizedPrescription {
  doctorName: string;
  doctorLicense: string;
  patientName: string;
  patientDocument: string;
  issuingCenter: string;
  prescribedAt: string;
  notes?: string;
}

export interface RecordedPrescription {
  id: string;
  folio: string;
}

/** D60: validity window of a prescription under `controlled.assisted`. */
export const PRESCRIPTION_VALIDITY_DAYS = 30;

const identifierPattern = /^[A-Za-z0-9-]{3,20}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * SQL predicate for "effectively controlled" (D57): the product flag, its category flag, or the
 * CONTROLLED sale classification. `product` and `category` are the SQL aliases in the query.
 */
export function controlledProductPredicate(product: string, category: string): string {
  return `(${product}.is_controlled or coalesce(${category}.is_controlled, false) or ${product}.sale_classification = 'CONTROLLED')`;
}

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({ code: "INVALID_INPUT", field, message });
}

function requiredText(value: unknown, field: string, label: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw invalid(field, `${label} es obligatorio.`);
  if (normalized.length > max) throw invalid(field, `${label} admite como máximo ${max} caracteres.`);
  return normalized;
}

function isRealDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Trims and validates the required fields. Returns undefined when no prescription was sent. */
export function normalizePrescription(input: unknown): NormalizedPrescription | undefined {
  if (input === undefined || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const prescribedAt = requiredText(raw.prescribedAt, "prescribedAt", "La fecha de la receta", 10);
  if (!isRealDate(prescribedAt)) throw invalid("prescribedAt", "La fecha de la receta no es válida (use AAAA-MM-DD).");
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  if (notes.length > 500) throw invalid("notes", "Las observaciones admiten como máximo 500 caracteres.");
  return {
    doctorName: requiredText(raw.doctorName, "doctorName", "El nombre del médico", 160),
    doctorLicense: requiredText(raw.doctorLicense, "doctorLicense", "La matrícula del médico", 40),
    patientName: requiredText(raw.patientName, "patientName", "El nombre del paciente", 160),
    patientDocument: requiredText(raw.patientDocument, "patientDocument", "El documento del paciente", 40),
    issuingCenter: requiredText(raw.issuingCenter, "issuingCenter", "El centro de salud emisor", 160),
    prescribedAt,
    ...(notes ? { notes } : {})
  };
}

/**
 * Stricter checks for plans with `controlled.assisted`: ID formats and a prescription date that is
 * neither in the future nor older than the validity window (D60).
 */
export function assertAssistedPrescription(prescription: NormalizedPrescription, now: Date = new Date()): void {
  if (!identifierPattern.test(prescription.doctorLicense)) {
    throw invalid("doctorLicense", "La matrícula debe tener entre 3 y 20 letras, números o guiones.");
  }
  if (!identifierPattern.test(prescription.patientDocument)) {
    throw invalid("patientDocument", "El documento del paciente debe tener entre 3 y 20 letras, números o guiones.");
  }
  const today = now.toISOString().slice(0, 10);
  if (prescription.prescribedAt > today) {
    throw invalid("prescribedAt", "La fecha de la receta no puede ser futura.");
  }
  const oldest = new Date(`${today}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - PRESCRIPTION_VALIDITY_DAYS);
  if (prescription.prescribedAt < oldest.toISOString().slice(0, 10)) {
    throw invalid("prescribedAt", `La receta tiene más de ${PRESCRIPTION_VALIDITY_DAYS} días y ya no es válida.`);
  }
}

export function prescriptionRequired(): BadRequestException {
  return new BadRequestException({
    code: "PRESCRIPTION_REQUIRED",
    message: "La venta incluye un medicamento controlado: registra los datos de la receta para continuar."
  });
}

/** True when any of the presentations belongs to an effectively controlled product. */
export async function containsControlledProduct(
  client: PoolClient,
  scope: TenantScope,
  presentationIds: readonly string[]
): Promise<boolean> {
  const result = await client.query(
    `select 1
     from product_presentations pr
     join products p on p.tenant_id = pr.tenant_id and p.id = pr.product_id
     left join product_categories c on c.tenant_id = p.tenant_id and c.id = p.category_id
     where pr.tenant_id = $1 and pr.id::text = any($2::text[])
       and ${controlledProductPredicate("p", "c")}
     limit 1`,
    [scope.tenantId, presentationIds]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Inserts the prescription in the sale's transaction and allocates its per-branch folio. */
export async function insertPrescription(
  client: PoolClient,
  scope: TenantScope,
  saleId: string,
  prescription: NormalizedPrescription,
  sequences: DocumentSequenceService
): Promise<RecordedPrescription> {
  const branch = await client.query<{ code: string }>(
    "select code from branches where tenant_id = $1 and id = $2",
    [scope.tenantId, scope.branchId]
  );
  const number = await sequences.nextNumberInTransaction(client, "CONTROLLED_PRESCRIPTION");
  const folio = `R-${branch.rows[0]?.code ?? "SUC"}-${number.toString().padStart(6, "0")}`;
  const result = await client.query<{ id: string }>(
    `insert into controlled_prescriptions
       (tenant_id, branch_id, sale_id, folio, doctor_name, doctor_license, patient_name, patient_document,
        issuing_center, prescribed_at, notes, created_by_user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12)
     returning id`,
    [
      scope.tenantId,
      scope.branchId,
      saleId,
      folio,
      prescription.doctorName,
      prescription.doctorLicense,
      prescription.patientName,
      prescription.patientDocument,
      prescription.issuingCenter,
      prescription.prescribedAt,
      prescription.notes ?? null,
      scope.userId
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Prescription was not created.");
  return { id: row.id, folio };
}
