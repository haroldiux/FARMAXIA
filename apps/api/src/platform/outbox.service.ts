import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

export interface CreateOutboxDto {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  scheduledFor?: Date;
}

export interface OutboxEvent {
  id: string;
  tenantId: string;
  branchId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: string;
  retryCount: number;
  scheduledFor: Date;
  processedAt: Date | null;
  createdAt: Date;
}

export class OutboxService {
  constructor(private readonly _tenantDatabase?: TenantDatabase) {}

  async enqueueInTransaction(
    client: PoolClient,
    scopeOrDto: TenantScope | CreateOutboxDto,
    maybeDto?: CreateOutboxDto
  ): Promise<OutboxEvent> {
    const dto = maybeDto ?? (scopeOrDto as CreateOutboxDto);

    const res = await client.query<OutboxEvent>(
      `insert into outbox_events (
        tenant_id,
        branch_id,
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        status,
        retry_count,
        scheduled_for
      )
      values (
        nullif(current_setting('app.tenant_id', true), '')::uuid,
        nullif(current_setting('app.branch_id', true), '')::uuid,
        $1, $2, $3, $4, 'PENDING', 0, coalesce($5, now())
      )
      returning
        id,
        tenant_id as "tenantId",
        branch_id as "branchId",
        aggregate_type as "aggregateType",
        aggregate_id as "aggregateId",
        event_type as "eventType",
        payload,
        status,
        retry_count as "retryCount",
        scheduled_for as "scheduledFor",
        processed_at as "processedAt",
        created_at as "createdAt"`,
      [
        dto.aggregateType,
        dto.aggregateId,
        dto.eventType,
        JSON.stringify(dto.payload),
        dto.scheduledFor ?? null
      ]
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error("Failed to enqueue outbox event.");
    }
    return row;
  }
}
