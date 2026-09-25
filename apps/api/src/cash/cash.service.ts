import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";
import {
  computePayloadHash,
  IdempotencyKeyReusedError
} from "../transversal/idempotency.service.js";

export interface CashRegisterSummary {
  id: string;
  code: string;
}

export interface EligibleCashUser {
  id: string;
  displayName: string;
}

export interface CreateCashShiftInput {
  idempotencyKey: string;
  cashRegisterId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  userIds: readonly string[];
}

export interface CashShiftSummary {
  id: string;
  cashRegisterId: string;
  cashRegisterCode: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  status: "SCHEDULED" | "CANCELED";
  users: EligibleCashUser[];
  control?: CashShiftControlSummary;
}

export type CashShiftControlStatus = "OPEN" | "PENDING_APPROVAL" | "CLOSED";

export interface CashShiftControlSummary {
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

export interface CashRegisterListResult {
  items: CashRegisterSummary[];
}

export interface EligibleCashUserListResult {
  items: EligibleCashUser[];
}

export interface CashShiftListResult {
  items: CashShiftSummary[];
}

interface ShiftRow {
  id: string;
  cashRegisterId: string;
  cashRegisterCode: string;
  scheduledStartAt: Date | string;
  scheduledEndAt: Date | string;
  status: "SCHEDULED" | "CANCELED";
}

interface ShiftUserRow extends EligibleCashUser {
  cashShiftId: string;
}

interface ControlRow {
  id: string;
  cashShiftId: string;
  openingAmountBob: string;
  expectedAmountBob: string;
  countedAmountBob: string | null;
  differenceAmountBob: string | null;
  status: CashShiftControlStatus;
  openedByUserId: string;
  openedAt: Date | string;
  countedByUserId: string | null;
  countedAt: Date | string | null;
  approvedByUserId: string | null;
  approvedAt: Date | string | null;
  closedByUserId: string | null;
  closedAt: Date | string | null;
  approvalNote: string | null;
}

interface StoredIdempotency<T> {
  requestHash: string;
  statusCode: number;
  responsePayload: T;
}

export class CashShiftOverlapError extends ConflictException {
  readonly code = "CASH_SHIFT_OVERLAP";
  readonly statusCode = 409;

  constructor() {
    super({
      code: "CASH_SHIFT_OVERLAP",
      message: "The cash register already has a shift in that interval."
    });
  }
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequestException(`${field} must be non-empty and at most ${maxLength} characters.`);
  }
  return normalized;
}

function timestamp(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO timestamp.`);
  }
  return parsed;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

const moneyPattern = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

function money(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized || !moneyPattern.test(normalized)) {
    throw new BadRequestException(`${field} must be a non-negative decimal with at most 4 places.`);
  }
  return normalized;
}

@Injectable()
export class CashService {
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async listRegisters(scope: TenantScope): Promise<CashRegisterListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<CashRegisterSummary>(
        `select id, code
         from cash_registers
         where tenant_id = $1 and branch_id = $2 and is_active = true
         order by code asc, id asc`,
        [scope.tenantId, scope.branchId]
      );
      return { items: result.rows };
    });
  }

  async listEligibleUsers(scope: TenantScope): Promise<EligibleCashUserListResult> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<EligibleCashUser>(
        `select app_user.id, app_user.display_name as "displayName"
         from user_branch_memberships membership
         join users app_user on app_user.id = membership.user_id
         where membership.tenant_id = $1
           and membership.branch_id = $2
           and app_user.is_active = true
         order by app_user.display_name asc, app_user.id asc`,
        [scope.tenantId, scope.branchId]
      );
      return { items: result.rows };
    });
  }

  async listShifts(scope: TenantScope): Promise<CashShiftListResult> {
    return this.database.withScope(scope, async (client) => ({
      items: await this.readShifts(client, scope)
    }));
  }

  async createShift(
    scope: TenantScope,
    input: CreateCashShiftInput
  ): Promise<CashShiftSummary> {
    const normalized = this.normalize(input);
    const operation = "cash.create_shift";
    const requestHash = computePayloadHash(normalized);

    return this.database.withScope(scope, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${scope.tenantId}:${operation}:${normalized.idempotencyKey}`
      ]);
      const existing = await this.findIdempotency<CashShiftSummary>(
        client,
        operation,
        normalized.idempotencyKey
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyKeyReusedError();
        }
        return existing.responsePayload;
      }

      const result = await this.insertShift(client, scope, normalized);
      await client.query(
        `insert into idempotency_records (
           tenant_id, branch_id, user_id, operation, idempotency_key,
           request_hash, status_code, response_payload
         ) values ($1, $2, $3, $4, $5, $6, 201, $7)`,
        [
          scope.tenantId,
          scope.branchId,
          scope.userId,
          operation,
          normalized.idempotencyKey,
          requestHash,
          JSON.stringify(result)
        ]
      );
      return result;
    });
  }

  async openShift(
    scope: TenantScope,
    shiftId: string,
    input: OpenCashShiftInput
  ): Promise<CashShiftControlSummary> {
    const normalizedShiftId = requiredText(shiftId, "Cash shift ID", 64);
    const idempotencyKey = requiredText(input.idempotencyKey, "Idempotency key", 255);
    const openingAmountBob = money(input.openingAmountBob, "Opening amount");
    return this.controlIdempotent(
      scope,
      "cash.open_shift",
      idempotencyKey,
      { shiftId: normalizedShiftId, openingAmountBob },
      async (client) => {
        const shift = await client.query<{ id: string }>(
          `select shift.id
           from cash_shifts shift
           where shift.tenant_id = $1 and shift.branch_id = $2 and shift.id = $3
             and shift.status = 'SCHEDULED'
             and exists (
               select 1 from cash_shift_users assignment
               join users app_user on app_user.id = assignment.user_id
               where assignment.tenant_id = shift.tenant_id
                 and assignment.branch_id = shift.branch_id
                 and assignment.cash_shift_id = shift.id
                 and assignment.user_id = $4 and app_user.is_active = true
             )
           for update`,
          [scope.tenantId, scope.branchId, normalizedShiftId, scope.userId]
        );
        if (!shift.rows[0]) {
          throw new BadRequestException("The shift is not scheduled for an active assigned user.");
        }
        const existing = await client.query("select 1 from cash_shift_controls where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3", [scope.tenantId, scope.branchId, normalizedShiftId]);
        if (existing.rowCount) {
          throw new ConflictException("The cash shift has already been opened.");
        }
        const inserted = await client.query<{ id: string }>(
          `insert into cash_shift_controls (
             tenant_id, branch_id, cash_shift_id, opening_amount_bob,
             expected_amount_bob, status, opened_by_user_id
           ) values ($1, $2, $3, $4, $4, 'OPEN', $5)
           returning id`,
          [scope.tenantId, scope.branchId, normalizedShiftId, openingAmountBob, scope.userId]
        );
        const control = await this.readControl(client, scope, normalizedShiftId, true);
        if (!control) throw new Error("Cash shift control was not created.");
        await this.audit.recordInTransaction(client, scope, {
          action: "cash.shift_opened",
          entityType: "cash_shift_control",
          entityId: inserted.rows[0]?.id ?? control.id,
          payload: { openingAmountBob, expectedAmountBob: openingAmountBob }
        });
        return { statusCode: 201, body: control };
      }
    );
  }

  async countShift(
    scope: TenantScope,
    shiftId: string,
    input: CountCashShiftInput
  ): Promise<CashShiftControlSummary> {
    const normalizedShiftId = requiredText(shiftId, "Cash shift ID", 64);
    const idempotencyKey = requiredText(input.idempotencyKey, "Idempotency key", 255);
    const countedAmountBob = money(input.countedAmountBob, "Counted amount");
    return this.controlIdempotent(
      scope,
      "cash.count_shift",
      idempotencyKey,
      { shiftId: normalizedShiftId, countedAmountBob },
      async (client) => {
        const control = await this.readControl(client, scope, normalizedShiftId, true);
        if (!control || control.status !== "OPEN") {
          throw new ConflictException("Only an open cash shift can be counted.");
        }
        await this.assertAssignedActiveUser(client, scope, normalizedShiftId);
        const updated = await client.query(
          `update cash_shift_controls
           set counted_amount_bob = $4::numeric,
               difference_amount_bob = $4::numeric - expected_amount_bob,
               status = case when $4::numeric = expected_amount_bob then 'CLOSED' else 'PENDING_APPROVAL' end,
               counted_by_user_id = $5::uuid,
               counted_at = now(),
               closed_by_user_id = case when $4::numeric = expected_amount_bob then $5::uuid else null end,
               closed_at = case when $4::numeric = expected_amount_bob then now() else null end
           where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3
           returning id`,
          [scope.tenantId, scope.branchId, normalizedShiftId, countedAmountBob, scope.userId]
        );
        if (!updated.rows[0]) throw new Error("Cash shift count was not saved.");
        const result = await this.readControl(client, scope, normalizedShiftId, true);
        if (!result) throw new Error("Cash shift control disappeared after count.");
        await this.audit.recordInTransaction(client, scope, {
          action: "cash.shift_counted",
          entityType: "cash_shift_control",
          entityId: result.id,
          payload: {
            countedAmountBob: result.countedAmountBob,
            differenceAmountBob: result.differenceAmountBob,
            status: result.status
          }
        });
        return { statusCode: 200, body: result };
      }
    );
  }

  async approveShift(
    scope: TenantScope,
    shiftId: string,
    input: ApproveCashShiftInput
  ): Promise<CashShiftControlSummary> {
    const normalizedShiftId = requiredText(shiftId, "Cash shift ID", 64);
    const idempotencyKey = requiredText(input.idempotencyKey, "Idempotency key", 255);
    const approvalNote = input.approvalNote?.trim() || null;
    if (approvalNote && approvalNote.length > 500) {
      throw new BadRequestException("Approval note must be at most 500 characters.");
    }
    return this.controlIdempotent(
      scope,
      "cash.approve_shift",
      idempotencyKey,
      { shiftId: normalizedShiftId, approvalNote },
      async (client) => {
        await this.assertPermission(client, scope, "cash.shift.approve");
        const control = await this.readControl(client, scope, normalizedShiftId, true);
        if (!control || control.status !== "PENDING_APPROVAL") {
          throw new ConflictException("Only a pending cash shift difference can be approved.");
        }
        const updated = await client.query(
          `update cash_shift_controls
           set status = 'CLOSED', approved_by_user_id = $4::uuid, approved_at = now(),
               closed_by_user_id = $4::uuid, closed_at = now(), approval_note = $5::varchar
           where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3
           returning id`,
          [scope.tenantId, scope.branchId, normalizedShiftId, scope.userId, approvalNote]
        );
        if (!updated.rows[0]) throw new Error("Cash shift approval was not saved.");
        const result = await this.readControl(client, scope, normalizedShiftId, true);
        if (!result) throw new Error("Cash shift control disappeared after approval.");
        await this.audit.recordInTransaction(client, scope, {
          action: "cash.shift_approved",
          entityType: "cash_shift_control",
          entityId: result.id,
          payload: { differenceAmountBob: result.differenceAmountBob, approvalNote }
        });
        return { statusCode: 200, body: result };
      }
    );
  }

  private async controlIdempotent<T>(
    scope: TenantScope,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    action: (client: PoolClient) => Promise<{ statusCode: number; body: T }>
  ): Promise<T> {
    return this.database.withScope(scope, async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${scope.tenantId}:${scope.branchId}:${operation}:${idempotencyKey}`
      ]);
      const requestHash = computePayloadHash(payload);
      const existing = await this.findIdempotency<T>(client, operation, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
        return existing.responsePayload;
      }
      const result = await action(client);
      await client.query(
        `insert into idempotency_records (
          tenant_id, branch_id, user_id, operation, idempotency_key,
          request_hash, status_code, response_payload
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [scope.tenantId, scope.branchId, scope.userId, operation, idempotencyKey, requestHash, result.statusCode, JSON.stringify(result.body)]
      );
      return result.body;
    });
  }

  private async assertAssignedActiveUser(client: PoolClient, scope: TenantScope, shiftId: string) {
    const result = await client.query(
      `select 1 from cash_shift_users assignment
       join users app_user on app_user.id = assignment.user_id
       where assignment.tenant_id = $1 and assignment.branch_id = $2
         and assignment.cash_shift_id = $3 and assignment.user_id = $4
         and app_user.is_active = true`,
      [scope.tenantId, scope.branchId, shiftId, scope.userId]
    );
    if (!result.rowCount) throw new BadRequestException("The user is not assigned to this cash shift.");
  }

  private async assertPermission(client: PoolClient, scope: TenantScope, permission: string) {
    const result = await client.query(
      `select 1
       from user_roles user_role
       join role_permissions role_permission on role_permission.role_id = user_role.role_id
       where user_role.user_id = $1 and user_role.tenant_id = $2
         and role_permission.permission_code = $3`,
      [scope.userId, scope.tenantId, permission]
    );
    if (!result.rowCount) throw new ConflictException("The user is not authorized to approve cash shifts.");
  }

  private normalize(input: CreateCashShiftInput): CreateCashShiftInput & {
    scheduledStart: Date;
    scheduledEnd: Date;
  } {
    const idempotencyKey = requiredText(input.idempotencyKey, "Idempotency key", 255);
    const cashRegisterId = requiredText(input.cashRegisterId, "Cash register ID", 64);
    const scheduledStart = timestamp(input.scheduledStartAt, "Scheduled start");
    const scheduledEnd = timestamp(input.scheduledEndAt, "Scheduled end");
    if (scheduledEnd.getTime() <= scheduledStart.getTime()) {
      throw new BadRequestException("Scheduled end must be after scheduled start.");
    }
    if (!Array.isArray(input.userIds) || input.userIds.length === 0) {
      throw new BadRequestException("At least one assigned user is required.");
    }
    const userIds = input.userIds.map((value) => requiredText(value, "User ID", 64));
    if (new Set(userIds).size !== userIds.length) {
      throw new BadRequestException("Assigned users must be distinct.");
    }
    userIds.sort();
    return {
      idempotencyKey,
      cashRegisterId,
      scheduledStartAt: scheduledStart.toISOString(),
      scheduledEndAt: scheduledEnd.toISOString(),
      scheduledStart,
      scheduledEnd,
      userIds
    };
  }

  private async findIdempotency<T>(
    client: PoolClient,
    operation: string,
    idempotencyKey: string
  ): Promise<StoredIdempotency<T> | undefined> {
    const result = await client.query<StoredIdempotency<T>>(
      `select request_hash as "requestHash",
              status_code as "statusCode",
              response_payload as "responsePayload"
       from idempotency_records
       where tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
         and operation = $1 and idempotency_key = $2`,
      [operation, idempotencyKey]
    );
    return result.rows[0];
  }

  private async readControl(
    client: PoolClient,
    scope: TenantScope,
    shiftId: string,
    forUpdate = false
  ): Promise<CashShiftControlSummary | undefined> {
    const lock = forUpdate ? " for update" : "";
    const result = await client.query<ControlRow>(
      `select id, cash_shift_id as "cashShiftId", opening_amount_bob::text as "openingAmountBob",
              expected_amount_bob::text as "expectedAmountBob", counted_amount_bob::text as "countedAmountBob",
              difference_amount_bob::text as "differenceAmountBob", status,
              opened_by_user_id as "openedByUserId", opened_at as "openedAt",
              counted_by_user_id as "countedByUserId", counted_at as "countedAt",
              approved_by_user_id as "approvedByUserId", approved_at as "approvedAt",
              closed_by_user_id as "closedByUserId", closed_at as "closedAt",
              approval_note as "approvalNote"
       from cash_shift_controls
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = $3${lock}`,
      [scope.tenantId, scope.branchId, shiftId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return this.mapControl(row);
  }

  private async insertShift(
    client: PoolClient,
    scope: TenantScope,
    input: ReturnType<CashService["normalize"]>
  ): Promise<CashShiftSummary> {
    const register = await client.query<CashRegisterSummary>(
      `select id, code from cash_registers
       where tenant_id = $1 and branch_id = $2 and id = $3 and is_active = true
       for update`,
      [scope.tenantId, scope.branchId, input.cashRegisterId]
    );
    const cashRegister = register.rows[0];
    if (!cashRegister) {
      throw new BadRequestException("Cash register is not active in the current branch.");
    }

    const users = await client.query<EligibleCashUser>(
      `select app_user.id, app_user.display_name as "displayName"
       from user_branch_memberships membership
       join users app_user on app_user.id = membership.user_id
       where membership.tenant_id = $1 and membership.branch_id = $2
         and membership.user_id = any($3::uuid[]) and app_user.is_active = true
       order by app_user.display_name asc, app_user.id asc`,
      [scope.tenantId, scope.branchId, input.userIds]
    );
    if (users.rows.length !== input.userIds.length) {
      throw new BadRequestException("Every assigned user must be active in the current branch.");
    }

    const overlap = await client.query(
      `select 1 from cash_shifts
       where tenant_id = $1 and branch_id = $2 and cash_register_id = $3
         and status = 'SCHEDULED'
         and scheduled_start_at < $5 and scheduled_end_at > $4
       limit 1`,
      [
        scope.tenantId,
        scope.branchId,
        input.cashRegisterId,
        input.scheduledStart,
        input.scheduledEnd
      ]
    );
    if (overlap.rowCount) {
      throw new CashShiftOverlapError();
    }

    const inserted = await client.query<{ id: string }>(
      `insert into cash_shifts (
         tenant_id, branch_id, cash_register_id, scheduled_start_at,
         scheduled_end_at, status, created_by_user_id
       ) values ($1, $2, $3, $4, $5, 'SCHEDULED', $6)
       returning id`,
      [
        scope.tenantId,
        scope.branchId,
        input.cashRegisterId,
        input.scheduledStart,
        input.scheduledEnd,
        scope.userId
      ]
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error("Cash shift was not created.");
    }
    for (const userId of input.userIds) {
      await client.query(
        `insert into cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id)
         values ($1, $2, $3, $4)`,
        [scope.tenantId, scope.branchId, id, userId]
      );
    }
    await this.audit.recordInTransaction(client, scope, {
      action: "cash.shift_scheduled",
      entityType: "cash_shift",
      entityId: id,
      payload: {
        cashRegisterId: input.cashRegisterId,
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        userIds: input.userIds
      }
    });
    return {
      id,
      cashRegisterId: cashRegister.id,
      cashRegisterCode: cashRegister.code,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      status: "SCHEDULED",
      users: users.rows
    };
  }

  private async readShifts(
    client: PoolClient,
    scope: TenantScope
  ): Promise<CashShiftSummary[]> {
    const shifts = await client.query<ShiftRow>(
      `select shift.id,
              shift.cash_register_id as "cashRegisterId",
              register.code as "cashRegisterCode",
              shift.scheduled_start_at as "scheduledStartAt",
              shift.scheduled_end_at as "scheduledEndAt",
              shift.status
       from cash_shifts shift
       join cash_registers register
         on register.tenant_id = shift.tenant_id
        and register.branch_id = shift.branch_id
        and register.id = shift.cash_register_id
       where shift.tenant_id = $1 and shift.branch_id = $2
       order by shift.scheduled_start_at asc, shift.id asc`,
      [scope.tenantId, scope.branchId]
    );
    if (!shifts.rows.length) {
      return [];
    }
    const shiftIds = shifts.rows.map((shift) => shift.id);
    const users = await client.query<ShiftUserRow>(
      `select assignment.cash_shift_id as "cashShiftId",
              app_user.id,
              app_user.display_name as "displayName"
       from cash_shift_users assignment
       join users app_user on app_user.id = assignment.user_id
       where assignment.tenant_id = $1 and assignment.branch_id = $2
         and assignment.cash_shift_id = any($3::uuid[])
       order by app_user.display_name asc, app_user.id asc`,
      [scope.tenantId, scope.branchId, shiftIds]
    );
    const controls = await client.query<ControlRow>(
      `select id, cash_shift_id as "cashShiftId", opening_amount_bob::text as "openingAmountBob",
              expected_amount_bob::text as "expectedAmountBob", counted_amount_bob::text as "countedAmountBob",
              difference_amount_bob::text as "differenceAmountBob", status,
              opened_by_user_id as "openedByUserId", opened_at as "openedAt",
              counted_by_user_id as "countedByUserId", counted_at as "countedAt",
              approved_by_user_id as "approvedByUserId", approved_at as "approvedAt",
              closed_by_user_id as "closedByUserId", closed_at as "closedAt",
              approval_note as "approvalNote"
       from cash_shift_controls
       where tenant_id = $1 and branch_id = $2 and cash_shift_id = any($3::uuid[])`,
      [scope.tenantId, scope.branchId, shiftIds]
    );
    return shifts.rows.map((shift) => {
      const control = controls.rows.find((candidate) => candidate.cashShiftId === shift.id);
      return {
        id: shift.id,
        cashRegisterId: shift.cashRegisterId,
        cashRegisterCode: shift.cashRegisterCode,
        scheduledStartAt: iso(shift.scheduledStartAt),
        scheduledEndAt: iso(shift.scheduledEndAt),
        status: shift.status,
        users: users.rows
          .filter((user) => user.cashShiftId === shift.id)
          .map(({ cashShiftId: _cashShiftId, ...user }) => user),
        ...(control ? { control: this.mapControl(control) } : {})
      };
    });
  }

  private mapControl(row: ControlRow): CashShiftControlSummary {
    return {
      id: row.id,
      cashShiftId: row.cashShiftId,
      openingAmountBob: row.openingAmountBob,
      expectedAmountBob: row.expectedAmountBob,
      countedAmountBob: row.countedAmountBob,
      differenceAmountBob: row.differenceAmountBob,
      status: row.status,
      openedByUserId: row.openedByUserId,
      openedAt: iso(row.openedAt),
      countedByUserId: row.countedByUserId,
      countedAt: row.countedAt ? iso(row.countedAt) : null,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt ? iso(row.approvedAt) : null,
      closedByUserId: row.closedByUserId,
      closedAt: row.closedAt ? iso(row.closedAt) : null,
      approvalNote: row.approvalNote
    };
  }
}
