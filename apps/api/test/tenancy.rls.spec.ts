import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase } from "../src/database/tenant-database.js";

const developmentDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";
const developmentAppDatabaseUrl =
  process.env.DATABASE_APP_URL ??
  "postgresql://farmaxia_app:local-development-only@localhost:5433/farmaxia";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const testDatabaseUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(developmentDatabaseUrl, "farmaxia_test");
const testAppDatabaseUrl =
  process.env.DATABASE_APP_TEST_URL ??
  withDatabaseName(developmentAppDatabaseUrl, "farmaxia_test");

const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";
const legalEntityA = "00000000-0000-4000-8000-000000000011";
const legalEntityB = "00000000-0000-4000-8000-000000000012";
const branchA = "00000000-0000-4000-8000-000000000021";
const branchB = "00000000-0000-4000-8000-000000000022";
const branchAOther = "00000000-0000-4000-8000-000000000023";
const userId = "00000000-0000-4000-8000-000000000031";
const tenantFileA = "00000000-0000-4000-8000-000000000041";
const tenantFileAOther = "00000000-0000-4000-8000-000000000042";
const tenantJobA = "00000000-0000-4000-8000-000000000051";
const tenantJobAOther = "00000000-0000-4000-8000-000000000052";

const ownerPool = new Pool({ connectionString: testDatabaseUrl });
const appPool = new Pool({ connectionString: testAppDatabaseUrl });
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const tenantDatabase = new TenantDatabase(testAppDatabaseUrl);

describe("tenancy schema", () => {
  beforeAll(async () => {
    const adminPool = new Pool({
      connectionString: withDatabaseName(developmentDatabaseUrl, "postgres")
    });
    const { rowCount } = await adminPool.query(
      "select 1 from pg_database where datname = 'farmaxia_test'"
    );
    if (rowCount === 0) {
      await adminPool.query("create database farmaxia_test");
    }
    await adminPool.end();

    await migrate(drizzle(ownerPool), { migrationsFolder });
  });

  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        subscription_quota_overrides,
        tenant_resource_usage,
        tenant_subscriptions,
        background_jobs,
        tenant_files,
        auth_sessions,
        user_roles,
        role_permissions,
        permissions,
        roles,
        user_branch_memberships,
        cash_registers,
        warehouses,
        branches,
        legal_entities,
        users,
        tenants
    `);

    await ownerPool.query(
      "insert into tenants (id, slug, name) values ($1, $2, $3), ($4, $5, $6)",
      [tenantA, "farmacia-a", "Farmacia A", tenantB, "farmacia-b", "Farmacia B"]
    );
    await ownerPool.query(
      `insert into legal_entities (id, tenant_id, legal_name, tax_id)
       values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        legalEntityA,
        tenantA,
        "Farmacia A SRL",
        "1000001",
        legalEntityB,
        tenantB,
        "Farmacia B SRL",
        "1000002"
      ]
    );
    await ownerPool.query(
      `insert into branches (id, tenant_id, legal_entity_id, code, name)
       values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)`,
      [
        branchA,
        tenantA,
        legalEntityA,
        "A-CENTRAL",
        "Central A",
        branchB,
        tenantB,
        legalEntityB,
        "B-CENTRAL",
        "Central B",
        branchAOther,
        tenantA,
        legalEntityA,
        "A-SUR",
        "Sur A"
      ]
    );
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash)
       values ($1, $2, $3, $4)`,
      [userId, "cashier@example.test", "Cajero", "not-a-real-password-hash"]
    );
    await ownerPool.query(
      `insert into user_branch_memberships (user_id, tenant_id, branch_id)
       values ($1, $2, $3)`,
      [userId, tenantA, branchA]
    );
  });

  afterAll(async () => {
    await tenantDatabase.close();
    await appPool.end();
    await ownerPool.end();
  });

  it("creates tenant data tables with forced row-level security", async () => {
    const { rows } = await ownerPool.query<{
      tableName: string;
      rowSecurity: boolean;
      forceRowSecurity: boolean;
    }>(`
      select
        relname as "tableName",
        relrowsecurity as "rowSecurity",
        relforcerowsecurity as "forceRowSecurity"
      from (select to_regclass('public.tenants') as table_oid) target
      left join pg_class on pg_class.oid = target.table_oid
    `);

    expect(rows).toEqual([
      {
        tableName: "tenants",
        rowSecurity: true,
        forceRowSecurity: true
      }
    ]);
  });

  it("hides other tenants and does not leak the transaction context", async () => {
    const withoutContext = await appPool.query("select id from tenants order by id");
    expect(withoutContext.rows).toEqual([]);

    const visibleTenantIds = await tenantDatabase.withTenant(tenantA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select id from tenants order by id"
      );
      return rows.map((row) => row.id);
    });
    expect(visibleTenantIds).toEqual([tenantA]);

    const withoutContextAfterTransaction = await appPool.query(
      "select id from tenants order by id"
    );
    expect(withoutContextAfterTransaction.rows).toEqual([]);
  });

  it("rejects a branch membership that crosses tenant boundaries", async () => {
    await expect(
      ownerPool.query(
        `insert into user_branch_memberships (user_id, tenant_id, branch_id)
         values ($1, $2, $3)`,
        [userId, tenantA, branchB]
      )
    ).rejects.toMatchObject({ code: "23503" });

    const memberships = await ownerPool.query(
      "select user_id, tenant_id, branch_id from user_branch_memberships order by branch_id"
    );
    expect(memberships.rows).toEqual([
      { user_id: userId, tenant_id: tenantA, branch_id: branchA }
    ]);
  });

  it("keeps branch-scoped resources inside the authenticated branch", async () => {
    await ownerPool.query(
      `insert into tenant_files (id, tenant_id, branch_id, storage_key, media_type, byte_size)
       values
         ($1, $2, $3, $4, $5, $6),
         ($7, $8, $9, $10, $11, $12)`,
      [
        tenantFileA,
        tenantA,
        branchA,
        `tenants/${tenantA}/branches/${branchA}/files/${tenantFileA}`,
        "text/csv",
        12,
        tenantFileAOther,
        tenantA,
        branchAOther,
        `tenants/${tenantA}/branches/${branchAOther}/files/${tenantFileAOther}`,
        "text/csv",
        12
      ]
    );
    await ownerPool.query(
      `insert into background_jobs (id, tenant_id, branch_id, kind, status, payload)
       values
         ($1, $2, $3, $4, $5, $6),
         ($7, $8, $9, $10, $11, $12)`,
      [
        tenantJobA,
        tenantA,
        branchA,
        "EXPORT",
        "QUEUED",
        JSON.stringify({ format: "csv" }),
        tenantJobAOther,
        tenantA,
        branchAOther,
        "EXPORT",
        "QUEUED",
        JSON.stringify({ format: "csv" })
      ]
    );

    const visible = await tenantDatabase.withScope(
      { tenantId: tenantA, userId, branchId: branchA },
      async (client) => {
        const branches = await client.query<{ id: string }>("select id from branches order by id");
        const files = await client.query<{ id: string }>("select id from tenant_files order by id");
        const jobs = await client.query<{ id: string }>("select id from background_jobs order by id");
        return {
          branches: branches.rows.map((row) => row.id),
          files: files.rows.map((row) => row.id),
          jobs: jobs.rows.map((row) => row.id)
        };
      }
    );

    expect(visible).toEqual({
      branches: [branchA],
      files: [tenantFileA],
      jobs: [tenantJobA]
    });
    await expect(
      tenantDatabase.withScope(
        { tenantId: tenantA, userId, branchId: branchA },
        (client) =>
          client.query(
            `insert into tenant_files (tenant_id, branch_id, storage_key, media_type, byte_size)
             values ($1, $2, $3, $4, $5)`,
            [
              tenantA,
              branchAOther,
              `tenants/${tenantA}/branches/${branchAOther}/files/new-file`,
              "text/csv",
              12
            ]
          )
      )
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      ownerPool.query(
        `insert into background_jobs
          (tenant_id, branch_id, kind, status, payload, result_file_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          tenantA,
          branchA,
          "EXPORT",
          "QUEUED",
          JSON.stringify({ format: "csv" }),
          tenantFileAOther
        ]
      )
    ).rejects.toMatchObject({ code: "23503" });
  });
});
