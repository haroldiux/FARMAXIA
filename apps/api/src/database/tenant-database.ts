import { Pool, type PoolClient } from "pg";

export interface TenantScope {
  tenantId: string;
  userId: string;
  branchId: string;
}

export class TenantDatabase {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_APP_URL) {
    if (!connectionString) {
      throw new Error("DATABASE_APP_URL is required for tenant-scoped queries.");
    }

    this.pool = new Pool({ connectionString });
  }

  async withTenant<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);

      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async withScope<T>(
    scope: TenantScope,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [scope.tenantId]);
      await client.query("select set_config('app.user_id', $1, true)", [scope.userId]);
      await client.query("select set_config('app.branch_id', $1, true)", [scope.branchId]);

      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
