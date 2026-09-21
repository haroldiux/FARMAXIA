import { authenticatedFetch } from "./session";

export interface CashRegister {
  id: string;
  code: string;
}

export interface EligibleCashUser {
  id: string;
  displayName: string;
}

export interface CashShift {
  id: string;
  cashRegisterId: string;
  cashRegisterCode: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: "SCHEDULED" | "CANCELED";
  users: EligibleCashUser[];
  control?: CashShiftControl;
}

export type CashShiftControlStatus = "OPEN" | "PENDING_APPROVAL" | "CLOSED";

export interface CashShiftControl {
  id: string;
  cashShiftId: string;
  openingAmountBob: string;
  expectedAmountBob: string;
  countedAmountBob: string | null;
  differenceAmountBob: string | null;
  status: CashShiftControlStatus;
  openedByUserId: string;
  openedAt: string;
  countedByUserId: string | null;
  countedAt: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  closedByUserId: string | null;
  closedAt: string | null;
  approvalNote: string | null;
}

export interface CreateCashShiftInput {
  idempotencyKey: string;
  cashRegisterId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  userIds: string[];
}

export interface OpenCashShiftInput {
  idempotencyKey: string;
  openingAmountBob: string;
}

export interface CountCashShiftInput {
  idempotencyKey: string;
  countedAmountBob: string;
}

export interface ApproveCashShiftInput {
  idempotencyKey: string;
  approvalNote?: string;
}

export function cashShiftIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cash-shift-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseError(response: Response): Promise<Error> {
  let message = "No pudimos completar la operación de caja.";
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      error?: { message?: string };
      code?: string;
    };
    if (body.code === "CASH_SHIFT_OVERLAP") {
      message = "La caja ya tiene un turno dentro de ese horario.";
    } else if (Array.isArray(body.message)) {
      message = body.message.join(" ");
    } else {
      message = body.message ?? body.error?.message ?? message;
    }
  } catch {
    // Keep a stable message when the API has no JSON response.
  }
  if (response.status === 403) {
    message = "Tu sesión no tiene permiso para administrar turnos de caja.";
  }
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}

export function listCashRegisters(): Promise<{ items: CashRegister[] }> {
  return request("/api/v1/cash/registers");
}

export function listEligibleCashUsers(): Promise<{ items: EligibleCashUser[] }> {
  return request("/api/v1/cash/eligible-users");
}

export function listCashShifts(): Promise<{ items: CashShift[] }> {
  return request("/api/v1/cash/shifts");
}

export function createCashShift(input: CreateCashShiftInput): Promise<CashShift> {
  return request("/api/v1/cash/shifts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey
    },
    body: JSON.stringify(input)
  });
}

export function openCashShift(shiftId: string, input: OpenCashShiftInput): Promise<CashShiftControl> {
  return request(`/api/v1/cash/shifts/${shiftId}/open`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input)
  });
}

export function countCashShift(shiftId: string, input: CountCashShiftInput): Promise<CashShiftControl> {
  return request(`/api/v1/cash/shifts/${shiftId}/count`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input)
  });
}

export function approveCashShift(shiftId: string, input: ApproveCashShiftInput): Promise<CashShiftControl> {
  return request(`/api/v1/cash/shifts/${shiftId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
    body: JSON.stringify(input)
  });
}
