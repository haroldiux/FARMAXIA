import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
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

interface StoredIdempotency {
  requestHash: string;
  statusCode: number;
  responsePayload: CashShiftSummary;
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

@Injectable()
export class CashService {
  private readonly audit = new AuditService();

  constructor(private readonly database: TenantDatabase) {}

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
      const existing = await this.findIdempotency(
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

  private async findIdempotency(
    client: PoolClient,
    operation: string,
    idempotencyKey: string
  ): Promise<StoredIdempotency | undefined> {
    const result = await client.query<StoredIdempotency>(
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
    return shifts.rows.map((shift) => ({
      id: shift.id,
      cashRegisterId: shift.cashRegisterId,
      cashRegisterCode: shift.cashRegisterCode,
      scheduledStartAt: iso(shift.scheduledStartAt),
      scheduledEndAt: iso(shift.scheduledEndAt),
      status: shift.status,
      users: users.rows
        .filter((user) => user.cashShiftId === shift.id)
        .map(({ cashShiftId: _cashShiftId, ...user }) => user)
    }));
  }
}
