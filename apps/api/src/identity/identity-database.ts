import { Pool, type PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";

/**
 * Conexión del rol `farmaxia_identity`: usuarios, roles y accesos de UNA farmacia.
 * Las políticas RLS limitan todo a `app.tenant_id`; solo la usan las rutas protegidas
 * por `users.manage`.
 */
export class IdentityDatabase {
  private pool?: Pool;

  constructor(private readonly connectionString?: string) {}

  async withScope<T>(scope: TenantScope, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    let transactionStarted = false;
    try {
      await client.query("begin");
      transactionStarted = true;
      await client.query("select set_config('app.tenant_id', $1, true)", [scope.tenantId]);
      await client.query("select set_config('app.user_id', $1, true)", [scope.userId]);
      await client.query("select set_config('app.branch_id', $1, true)", [scope.branchId]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      if (transactionStarted) {
        await client.query("rollback");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  private getPool(): Pool {
    if (!this.pool) {
      const connectionString = this.connectionString ?? process.env.DATABASE_IDENTITY_URL;
      if (!connectionString) {
        throw new Error("DATABASE_IDENTITY_URL is required for user administration.");
      }
      this.pool = new Pool({ connectionString });
    }
    return this.pool;
  }
}
