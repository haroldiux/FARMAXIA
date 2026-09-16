import { Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";

export interface AuthDatabaseContext {
  tenantId?: string;
  userId?: string;
  loginEmail?: string;
  refreshTokenHash?: string;
}

@Injectable()
export class AuthDatabase {
  private pool?: Pool;

  async withTransaction<T>(
    context: AuthDatabaseContext,
    operation: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getPool().connect();
    let transactionStarted = false;

    try {
      await client.query("begin");
      transactionStarted = true;
      if (context.tenantId) {
        await client.query("select set_config('app.tenant_id', $1, true)", [
          context.tenantId
        ]);
      }
      if (context.userId) {
        await client.query("select set_config('app.user_id', $1, true)", [
          context.userId
        ]);
      }
      if (context.loginEmail) {
        await client.query("select set_config('app.login_email', $1, true)", [
          context.loginEmail
        ]);
      }
      if (context.refreshTokenHash) {
        await client.query("select set_config('app.refresh_token_hash', $1, true)", [
          context.refreshTokenHash
        ]);
      }

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
      const connectionString = process.env.DATABASE_AUTH_URL;
      if (!connectionString) {
        throw new Error("DATABASE_AUTH_URL is required for authentication queries.");
      }
      this.pool = new Pool({ connectionString });
    }
    return this.pool;
  }
}
