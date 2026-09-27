import { Pool, type PoolClient } from "pg";

/**
 * Conexión del rol `farmaxia_platform`: alta de farmacias y administración del SaaS.
 * Ve todas las farmacias, así que solo la usan el alta pública (sentencias fijas) y
 * las rutas de operador de plataforma; nunca las rutas de una farmacia.
 * Se registra con `useFactory` en SaasModule; las pruebas pasan su propia URL.
 */
export class PlatformDatabase {
  private pool?: Pool;

  constructor(private readonly connectionString?: string) {}

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    let transactionStarted = false;
    try {
      await client.query("begin");
      transactionStarted = true;
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
      const connectionString = this.connectionString ?? process.env.DATABASE_PLATFORM_URL;
      if (!connectionString) {
        throw new Error("DATABASE_PLATFORM_URL is required for platform operations.");
      }
      this.pool = new Pool({ connectionString });
    }
    return this.pool;
  }
}
