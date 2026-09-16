import type { PoolClient } from "pg";
import type { TenantDatabase, TenantScope } from "../database/tenant-database.js";

export class DocumentSequenceService {
  constructor(private readonly tenantDatabase?: TenantDatabase) {}

  async allocate(scope: TenantScope, documentType: string): Promise<bigint> {
    if (!this.tenantDatabase) {
      throw new Error("TenantDatabase must be provided to allocate document sequences outside an existing transaction.");
    }
    return this.tenantDatabase.withScope(scope, async (client) => {
      return this.allocateInTransaction(client, scope, documentType);
    });
  }

  async allocateInTransaction(
    client: PoolClient,
    _scope: TenantScope,
    documentType: string
  ): Promise<bigint> {
    return this.nextNumberInTransaction(client, documentType);
  }

  async nextNumberInTransaction(
    client: PoolClient,
    documentType: string
  ): Promise<bigint> {
    if (!documentType || documentType.trim() === "") {
      throw new Error("Document type must not be empty.");
    }

    const res = await client.query<{ currentNumber: string | number | bigint }>(
      `insert into document_sequences (
        tenant_id,
        branch_id,
        document_type,
        current_number,
        updated_at
      )
      values (
        nullif(current_setting('app.tenant_id', true), '')::uuid,
        nullif(current_setting('app.branch_id', true), '')::uuid,
        $1,
        1,
        now()
      )
      on conflict (tenant_id, branch_id, document_type)
      do update set
        current_number = document_sequences.current_number + 1,
        updated_at = now()
      returning current_number as "currentNumber"`,
      [documentType]
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error("Failed to generate next document sequence number.");
    }

    return BigInt(row.currentNumber);
  }
}
