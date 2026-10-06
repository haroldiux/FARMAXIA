import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { AuditService } from "../transversal/audit.service.js";
import { ZONE, invalid, optionalDate, requireFeature, requireUuid } from "./staff.common.js";

const FEATURE = "staff.shifts";
const MAX_ROWS = 500;
const MAX_SHIFT_HOURS = 24;
/** D61: self check-in opens 30 minutes before the shift starts and closes when it ends. */
const CHECK_IN_TOLERANCE_MINUTES = 30;
const KINDS = ["REGULAR", "NIGHT_DUTY"] as const;

export type ShiftKind = (typeof KINDS)[number];

export interface StaffShift {
  id: string;
  userId: string;
  userName: string;
  kind: ShiftKind;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  status: "SCHEDULED" | "CANCELED";
  cancelReason: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface StaffMember {
  userId: string;
  displayName: string;
}

export interface ShiftListQuery {
  /** Shift start date range (inclusive, Bolivia time), YYYY-MM-DD. */
  from?: string;
  to?: string;
  userId?: string;
}

export interface CreateShiftInput {
  userId: string;
  kind: ShiftKind;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
}

interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  kind: ShiftKind;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  status: "SCHEDULED" | "CANCELED";
  cancelReason: string | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
}

const shiftSelect = `
  select s.id, s.user_id as "userId", u.display_name as "userName", s.kind, s.starts_at as "startsAt",
         s.ends_at as "endsAt", s.notes, s.status, s.cancel_reason as "cancelReason",
         s.checked_in_at as "checkedInAt", s.checked_out_at as "checkedOutAt",
         s.created_by_user_id as "createdByUserId", s.created_at as "createdAt"
  from staff_shifts s join users u on u.id = s.user_id`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toShift(row: ShiftRow): StaffShift {
  return {
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    checkedInAt: iso(row.checkedInAt),
    checkedOutAt: iso(row.checkedOutAt),
    createdAt: row.createdAt.toISOString()
  };
}

function parseInstant(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw invalid(field, "La fecha y hora no son válidas (use formato ISO 8601).");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw invalid(field, "La fecha y hora no son válidas.");
  return parsed;
}

@Injectable()
export class StaffShiftsService {
  private readonly features: FeatureService;
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {
    this.features = new FeatureService(database);
  }

  /** Members of the active branch, for the roster pickers. */
  async listMembers(scope: TenantScope): Promise<StaffMember[]> {
    await requireFeature(this.features, scope, FEATURE);
    return this.database.withScope(scope, async (client) => {
      const rows = await client.query<StaffMember>(
        `select m.user_id as "userId", u.display_name as "displayName"
         from user_branch_memberships m join users u on u.id = m.user_id
         where m.tenant_id = $1 and m.branch_id = $2
         order by u.display_name, m.user_id`,
        [scope.tenantId, scope.branchId]
      );
      return rows.rows;
    });
  }

  async listShifts(scope: TenantScope, query: ShiftListQuery): Promise<StaffShift[]> {
    await requireFeature(this.features, scope, FEATURE);
    const from = optionalDate(query.from, "from");
    const to = optionalDate(query.to, "to");
    const userId = query.userId ? requireUuid(query.userId, "userId") : null;
    return this.query(scope, from, to, userId);
  }

  async myShifts(scope: TenantScope, query: Pick<ShiftListQuery, "from" | "to">): Promise<StaffShift[]> {
    await requireFeature(this.features, scope, FEATURE);
    return this.query(scope, optionalDate(query.from, "from"), optionalDate(query.to, "to"), scope.userId);
  }

  private query(scope: TenantScope, from: string | null, to: string | null, userId: string | null): Promise<StaffShift[]> {
    return this.database.withScope(scope, async (client) => {
      const rows = await client.query<ShiftRow>(
        `${shiftSelect}
         where s.tenant_id = $1 and s.branch_id = $2
           and ($3::date is null or (s.starts_at at time zone '${ZONE}')::date >= $3::date)
           and ($4::date is null or (s.starts_at at time zone '${ZONE}')::date <= $4::date)
           and ($5::uuid is null or s.user_id = $5::uuid)
         order by s.starts_at, s.id
         limit ${MAX_ROWS}`,
        [scope.tenantId, scope.branchId, from, to, userId]
      );
      return rows.rows.map(toShift);
    });
  }

  async createShift(scope: TenantScope, input: CreateShiftInput): Promise<StaffShift> {
    await requireFeature(this.features, scope, FEATURE);
    const userId = requireUuid(input?.userId, "userId");
    if (!KINDS.includes(input.kind)) throw invalid("kind", "El tipo de turno debe ser REGULAR o NIGHT_DUTY.");
    const startsAt = parseInstant(input.startsAt, "startsAt");
    const endsAt = parseInstant(input.endsAt, "endsAt");
    if (endsAt <= startsAt) throw invalid("endsAt", "El fin del turno debe ser posterior al inicio.");
    if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_HOURS * 3_600_000) {
      throw invalid("endsAt", `Un turno no puede durar más de ${MAX_SHIFT_HOURS} horas.`);
    }
    const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
    if (notes && notes.length > 300) throw invalid("notes", "Las notas admiten como máximo 300 caracteres.");

    return this.database.withScope(scope, async (client) => {
      const member = await client.query(
        "select 1 from user_branch_memberships where tenant_id = $1 and branch_id = $2 and user_id = $3",
        [scope.tenantId, scope.branchId, userId]
      );
      if (!member.rowCount) {
        throw new BadRequestException({ code: "USER_NOT_IN_BRANCH", message: "El usuario no pertenece a esta sucursal." });
      }
      // Serialize concurrent creations for the same person so the overlap check cannot be raced.
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`staff-shift:${scope.tenantId}:${scope.branchId}:${userId}`]);
      const clash = await client.query(
        `select 1 from staff_shifts
         where tenant_id = $1 and branch_id = $2 and user_id = $3 and status = 'SCHEDULED'
           and starts_at < $5 and ends_at > $4`,
        [scope.tenantId, scope.branchId, userId, startsAt, endsAt]
      );
      if (clash.rowCount) {
        throw new ConflictException({ code: "SHIFT_OVERLAP", message: "La persona ya tiene un turno que se cruza con ese horario." });
      }
      const inserted = await client.query<{ id: string }>(
        `insert into staff_shifts (tenant_id, branch_id, user_id, kind, starts_at, ends_at, notes, created_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [scope.tenantId, scope.branchId, userId, input.kind, startsAt, endsAt, notes, scope.userId]
      );
      const shiftId = inserted.rows[0]!.id;
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.shift.created",
        entityType: "staff_shift",
        entityId: shiftId,
        payload: { userId, kind: input.kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
      });
      return this.load(client, scope, shiftId);
    });
  }

  async cancelShift(scope: TenantScope, shiftId: string, input: { reason: string }): Promise<StaffShift> {
    await requireFeature(this.features, scope, FEATURE);
    const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
    if (!reason) throw invalid("reason", "Indique el motivo de la cancelación.");
    if (reason.length > 200) throw invalid("reason", "El motivo admite como máximo 200 caracteres.");
    return this.database.withScope(scope, async (client) => {
      const shift = await this.lock(client, scope, shiftId);
      if (shift.status === "CANCELED") {
        throw new ConflictException({ code: "SHIFT_ALREADY_CANCELED", message: "El turno ya estaba cancelado." });
      }
      if (shift.checkedInAt) {
        throw new ConflictException({ code: "SHIFT_ALREADY_STARTED", message: "El turno ya tiene registro de entrada y no se puede cancelar." });
      }
      await client.query(
        "update staff_shifts set status = 'CANCELED', cancel_reason = $4, canceled_at = now() where tenant_id = $1 and branch_id = $2 and id = $3",
        [scope.tenantId, scope.branchId, shiftId, reason]
      );
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.shift.canceled",
        entityType: "staff_shift",
        entityId: shiftId,
        payload: { userId: shift.userId, reason }
      });
      return this.load(client, scope, shiftId);
    });
  }

  async checkIn(scope: TenantScope, shiftId: string): Promise<StaffShift> {
    await requireFeature(this.features, scope, FEATURE);
    return this.database.withScope(scope, async (client) => {
      const shift = await this.lockOwn(client, scope, shiftId);
      if (shift.checkedInAt) {
        throw new ConflictException({ code: "ALREADY_CHECKED_IN", message: "Ya registraste tu entrada en este turno." });
      }
      const window = await client.query<{ ok: boolean }>(
        `select (now() >= starts_at - make_interval(mins => $4) and now() < ends_at) as ok
         from staff_shifts where tenant_id = $1 and branch_id = $2 and id = $3`,
        [scope.tenantId, scope.branchId, shiftId, CHECK_IN_TOLERANCE_MINUTES]
      );
      if (!window.rows[0]?.ok) {
        throw new BadRequestException({
          code: "CHECK_IN_OUT_OF_WINDOW",
          message: `Solo puedes registrar entrada desde ${CHECK_IN_TOLERANCE_MINUTES} minutos antes del inicio y hasta el fin del turno.`
        });
      }
      await client.query("update staff_shifts set checked_in_at = now() where tenant_id = $1 and branch_id = $2 and id = $3", [scope.tenantId, scope.branchId, shiftId]);
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.shift.checked_in",
        entityType: "staff_shift",
        entityId: shiftId,
        payload: { userId: scope.userId }
      });
      return this.load(client, scope, shiftId);
    });
  }

  async checkOut(scope: TenantScope, shiftId: string): Promise<StaffShift> {
    await requireFeature(this.features, scope, FEATURE);
    return this.database.withScope(scope, async (client) => {
      const shift = await this.lockOwn(client, scope, shiftId);
      if (!shift.checkedInAt) {
        throw new BadRequestException({ code: "NOT_CHECKED_IN", message: "Primero registra tu entrada en este turno." });
      }
      if (shift.checkedOutAt) {
        throw new ConflictException({ code: "ALREADY_CHECKED_OUT", message: "Ya registraste tu salida en este turno." });
      }
      await client.query("update staff_shifts set checked_out_at = now() where tenant_id = $1 and branch_id = $2 and id = $3", [scope.tenantId, scope.branchId, shiftId]);
      await this.audit.recordInTransaction(client, scope, {
        action: "staff.shift.checked_out",
        entityType: "staff_shift",
        entityId: shiftId,
        payload: { userId: scope.userId }
      });
      return this.load(client, scope, shiftId);
    });
  }

  private async load(client: PoolClient, scope: TenantScope, shiftId: string): Promise<StaffShift> {
    const rows = await client.query<ShiftRow>(`${shiftSelect} where s.tenant_id = $1 and s.branch_id = $2 and s.id = $3`, [scope.tenantId, scope.branchId, shiftId]);
    return toShift(rows.rows[0]!);
  }

  private async lock(client: PoolClient, scope: TenantScope, shiftId: string): Promise<ShiftRow> {
    if (typeof shiftId !== "string" || !/^[0-9a-f-]{36}$/i.test(shiftId)) {
      throw new NotFoundException({ code: "SHIFT_NOT_FOUND", message: "Turno no encontrado." });
    }
    const rows = await client.query<ShiftRow>(
      `${shiftSelect} where s.tenant_id = $1 and s.branch_id = $2 and s.id = $3 for update of s`,
      [scope.tenantId, scope.branchId, shiftId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "SHIFT_NOT_FOUND", message: "Turno no encontrado." });
    return rows.rows[0];
  }

  /** Own, active shift: attendance can only be recorded by its owner (403 otherwise). */
  private async lockOwn(client: PoolClient, scope: TenantScope, shiftId: string): Promise<ShiftRow> {
    const shift = await this.lock(client, scope, shiftId);
    if (shift.userId !== scope.userId) {
      throw new ForbiddenException({ code: "SHIFT_NOT_OWNED", message: "Solo puedes registrar asistencia en tus propios turnos." });
    }
    if (shift.status === "CANCELED") {
      throw new ConflictException({ code: "SHIFT_CANCELED", message: "El turno fue cancelado." });
    }
    return shift;
  }
}
