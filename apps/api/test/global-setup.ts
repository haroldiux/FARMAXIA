import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// Se ejecuta una vez antes de todas las suites: el orden de los archivos no
// está garantizado, así que ninguna suite puede depender de que otra cree la base.
export default async function setup(): Promise<void> {
  const testDatabaseUrl =
    process.env.DATABASE_TEST_URL ?? withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
  const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);

  const adminPool = new Pool({ connectionString: withDatabaseName(testDatabaseUrl, "postgres") });
  try {
    const { rowCount } = await adminPool.query("select 1 from pg_database where datname = $1", [testDatabaseName]);
    if (rowCount === 0) {
      await adminPool.query(`create database "${testDatabaseName.replaceAll('"', '""')}"`);
    }
  } finally {
    await adminPool.end();
  }

  const ownerPool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await migrate(drizzle(ownerPool), {
      migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle")
    });
  } finally {
    await ownerPool.end();
  }
}
