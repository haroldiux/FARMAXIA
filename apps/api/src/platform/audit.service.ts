import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

export interface CreateAuditDto {
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  branchId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export class AuditService {
  constructor(private readonly _tenantDatabase?: TenantDatabase) {}

  async recordInTransaction(
    client: PoolClient,
    scopeOrDto: TenantScope | CreateAuditDto,
    maybeDto?: CreateAuditDto
  ): Promise<AuditEvent> {
    const dto = maybeDto ?? (scopeOrDto as CreateAuditDto);

    const res = await client.query<AuditEvent>(
      `insert into audit_events (
        tenant_id,
        branch_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        payload
      )
      values (
        nullif(current_setting('app.tenant_id', true), '')::uuid,
        nullif(current_setting('app.branch_id', true), '')::uuid,
        nullif(current_setting('app.user_id', true), '')::uuid,
        $1, $2, $3, $4
      )
      returning
        id,
        tenant_id as "tenantId",
        branch_id as "branchId",
        actor_user_id as "actorUserId",
        action,
        entity_type as "entityType",
        entity_id as "entityId",
        payload,
        occurred_at as "occurredAt"`,
      [dto.action, dto.entityType, dto.entityId, JSON.stringify(dto.payload ?? {})]
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error("Failed to record audit event.");
    }
    return row;
  }
}
