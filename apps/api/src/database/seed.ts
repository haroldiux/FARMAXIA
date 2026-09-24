import { Pool } from "pg";
import argon2 from "argon2";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia";

const argon2idOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

export const SEED_DATA = {
  tenant: {
    id: "11111111-1111-4000-a000-000000000001",
    slug: "farmacia-central",
    name: "Farmacia Central"
  },
  legalEntity: {
    id: "22222222-2222-4000-a000-000000000001",
    legalName: "Farmacia Central S.R.L.",
    taxId: "1020304050"
  },
  branch: {
    id: "33333333-3333-4000-a000-000000000001",
    code: "SUC-001",
    name: "Casa Matriz"
  },
  warehouse: {
    id: "44444444-4444-4000-a000-000000000001",
    name: "Almacén Central",
    isDispatchEnabled: true
  },
  cashRegister: {
    id: "55555555-5555-4000-a000-000000000001",
    code: "CAJA-01",
    isActive: true
  },
  user: {
    id: "66666666-6666-4000-a000-000000000001",
    email: "admin@farmaxia.local",
    displayName: "Administrador Farmaxia",
    password: "Admin1234!"
  },
  role: {
    id: "77777777-7777-4000-a000-000000000001",
    code: "admin"
  },
  category: {
    id: "99999999-9999-4000-a000-000000000001",
    name: "Medicamentos Esenciales"
  },
  product: {
    id: "aaaaaaaa-aaaa-4000-a000-000000000001",
    name: "Paracetamol 500mg",
    activeIngredient: "Paracetamol"
  },
  presentation: {
    id: "bbbbbbbb-bbbb-4000-a000-000000000001",
    name: "Caja x 20 tabletas",
    baseUnitFactor: 20,
    barcode: "7771234567890"
  },
  priceList: {
    id: "dddddddd-dddd-4000-a000-000000000001",
    name: "Lista General",
    currency: "BOB",
    price: "15.0000"
  },
  supplier: {
    id: "ffffffff-ffff-4000-a000-000000000001",
    name: "Droguería Inti",
    taxId: "1029384756"
  },
  batch: {
    id: "00000000-1111-4000-a000-000000000001",
    lotCode: "LOTE-2026-A",
    expiresOn: "2027-12-31",
    unitCost: "8.5000",
    quantityBase: 200
  },
  shift: {
    id: "00000000-2222-4000-a000-000000000001",
    controlId: "00000000-3333-4000-a000-000000000001"
  }
};

async function seed() {
  console.log(`Connecting to database: ${connectionString.replace(/:[^:@]+@/, ":***@")}`);
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Seeding tenant and organization hierarchy...");
    await client.query(
      `INSERT INTO tenants (id, slug, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [SEED_DATA.tenant.id, SEED_DATA.tenant.slug, SEED_DATA.tenant.name]
    );

    await client.query(
      `INSERT INTO legal_entities (id, tenant_id, legal_name, tax_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET legal_name = excluded.legal_name, tax_id = excluded.tax_id`,
      [
        SEED_DATA.legalEntity.id,
        SEED_DATA.tenant.id,
        SEED_DATA.legalEntity.legalName,
        SEED_DATA.legalEntity.taxId
      ]
    );

    await client.query(
      `INSERT INTO branches (id, tenant_id, legal_entity_id, code, name, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_active = true`,
      [
        SEED_DATA.branch.id,
        SEED_DATA.tenant.id,
        SEED_DATA.legalEntity.id,
        SEED_DATA.branch.code,
        SEED_DATA.branch.name
      ]
    );

    await client.query(
      `INSERT INTO warehouses (id, tenant_id, branch_id, name, is_dispatch_enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_dispatch_enabled = true`,
      [
        SEED_DATA.warehouse.id,
        SEED_DATA.tenant.id,
        SEED_DATA.branch.id,
        SEED_DATA.warehouse.name,
        SEED_DATA.warehouse.isDispatchEnabled
      ]
    );

    await client.query(
      `INSERT INTO cash_registers (id, tenant_id, branch_id, code, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET code = excluded.code, is_active = true`,
      [
        SEED_DATA.cashRegister.id,
        SEED_DATA.tenant.id,
        SEED_DATA.branch.id,
        SEED_DATA.cashRegister.code,
        SEED_DATA.cashRegister.isActive
      ]
    );

    console.log("Seeding subscription plan...");
    const planRes = await client.query<{ id: string }>(
      "SELECT id FROM subscription_plans WHERE code = 'COMPLETO'"
    );
    let planId = planRes.rows[0]?.id;
    if (!planId) {
      const insertedPlan = await client.query<{ id: string }>(
        `INSERT INTO subscription_plans (name, code, is_active)
         VALUES ('Plan Completo', 'COMPLETO', true)
         RETURNING id`
      );
      const firstRow = insertedPlan.rows[0];
      if (!firstRow) {
        throw new Error("Failed to insert default COMPLETO plan");
      }
      planId = firstRow.id;
    }

    await client.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, starts_at)
       VALUES ('88888888-8888-4000-a000-000000000001', $1, $2, 'ACTIVE', NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [SEED_DATA.tenant.id, planId]
    );

    console.log("Seeding admin user and security roles...");
    const passwordHash = await argon2.hash(SEED_DATA.user.password, argon2idOptions);

    await client.query(
      `INSERT INTO users (id, email, display_name, password_hash, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, is_active = true`,
      [
        SEED_DATA.user.id,
        SEED_DATA.user.email,
        SEED_DATA.user.displayName,
        passwordHash
      ]
    );

    await client.query(
      `INSERT INTO user_branch_memberships (user_id, tenant_id, branch_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id, branch_id) DO NOTHING`,
      [SEED_DATA.user.id, SEED_DATA.tenant.id, SEED_DATA.branch.id]
    );

    await client.query(
      `INSERT INTO roles (id, tenant_id, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [SEED_DATA.role.id, SEED_DATA.tenant.id, SEED_DATA.role.code]
    );

    await client.query(
      `INSERT INTO user_roles (user_id, tenant_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`,
      [SEED_DATA.user.id, SEED_DATA.tenant.id, SEED_DATA.role.id]
    );

    const permissions = [
      { code: "cash.manage", desc: "Manage cash registers and shifts" },
      { code: "cash.shift.approve", desc: "Approve cash shift controls" },
      { code: "catalog.manage", desc: "Manage catalog and prices" },
      { code: "inventory.manage", desc: "Manage inventory operations" },
      { code: "inventory.report.global", desc: "View global inventory reports" },
      { code: "sales.confirm", desc: "Confirm non-fiscal cash sales" }
    ];

    for (const perm of permissions) {
      await client.query(
        `INSERT INTO permissions (code, description)
         VALUES ($1, $2)
         ON CONFLICT (code) DO NOTHING`,
        [perm.code, perm.desc]
      );
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_code)
         VALUES ($1, $2)
         ON CONFLICT (role_id, permission_code) DO NOTHING`,
        [SEED_DATA.role.id, perm.code]
      );
    }

    console.log("Seeding catalog and pricing...");
    await client.query(
      `INSERT INTO product_categories (id, tenant_id, name, is_controlled, is_active)
       VALUES ($1, $2, $3, false, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [SEED_DATA.category.id, SEED_DATA.tenant.id, SEED_DATA.category.name]
    );

    await client.query(
      `INSERT INTO products (id, tenant_id, category_id, name, active_ingredient, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [
        SEED_DATA.product.id,
        SEED_DATA.tenant.id,
        SEED_DATA.category.id,
        SEED_DATA.product.name,
        SEED_DATA.product.activeIngredient
      ]
    );

    await client.query(
      `INSERT INTO product_presentations (id, tenant_id, product_id, name, base_unit_factor, is_sellable)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_sellable = true`,
      [
        SEED_DATA.presentation.id,
        SEED_DATA.tenant.id,
        SEED_DATA.product.id,
        SEED_DATA.presentation.name,
        SEED_DATA.presentation.baseUnitFactor
      ]
    );

    await client.query(
      `INSERT INTO product_barcodes (id, tenant_id, presentation_id, barcode)
       VALUES ('cccccccc-cccc-4000-a000-000000000001', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET barcode = excluded.barcode`,
      [
        SEED_DATA.tenant.id,
        SEED_DATA.presentation.id,
        SEED_DATA.presentation.barcode
      ]
    );

    await client.query(
      `INSERT INTO price_lists (id, tenant_id, name, currency, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [
        SEED_DATA.priceList.id,
        SEED_DATA.tenant.id,
        SEED_DATA.priceList.name,
        SEED_DATA.priceList.currency
      ]
    );

    await client.query(
      `INSERT INTO presentation_prices (id, tenant_id, price_list_id, presentation_id, amount, valid_from)
       VALUES ('eeeeeeee-eeee-4000-a000-000000000001', $1, $2, $3, $4, '2026-01-01 00:00:00+00')
       ON CONFLICT (id) DO UPDATE SET amount = excluded.amount`,
      [
        SEED_DATA.tenant.id,
        SEED_DATA.priceList.id,
        SEED_DATA.presentation.id,
        SEED_DATA.priceList.price
      ]
    );

    console.log("Seeding supplier and stock batches...");
    await client.query(
      `INSERT INTO suppliers (id, tenant_id, name, tax_id, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name`,
      [
        SEED_DATA.supplier.id,
        SEED_DATA.tenant.id,
        SEED_DATA.supplier.name,
        SEED_DATA.supplier.taxId
      ]
    );

    await client.query(
      `INSERT INTO inventory_batches (id, tenant_id, presentation_id, supplier_id, lot_code, expires_on, unit_cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'AVAILABLE')
       ON CONFLICT (id) DO UPDATE SET status = 'AVAILABLE'`,
      [
        SEED_DATA.batch.id,
        SEED_DATA.tenant.id,
        SEED_DATA.presentation.id,
        SEED_DATA.supplier.id,
        SEED_DATA.batch.lotCode,
        SEED_DATA.batch.expiresOn,
        SEED_DATA.batch.unitCost
      ]
    );

    await client.query(
      `INSERT INTO inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (tenant_id, warehouse_id, batch_id)
       DO UPDATE SET quantity_base = excluded.quantity_base`,
      [
        SEED_DATA.tenant.id,
        SEED_DATA.warehouse.id,
        SEED_DATA.batch.id,
        SEED_DATA.batch.quantityBase
      ]
    );

    console.log("Seeding active cash shift...");
    await client.query(
      `INSERT INTO cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '12 hours', 'SCHEDULED', $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        SEED_DATA.shift.id,
        SEED_DATA.tenant.id,
        SEED_DATA.branch.id,
        SEED_DATA.cashRegister.id,
        SEED_DATA.user.id
      ]
    );

    await client.query(
      `INSERT INTO cash_shift_users (tenant_id, branch_id, cash_shift_id, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, branch_id, cash_shift_id, user_id) DO NOTHING`,
      [
        SEED_DATA.tenant.id,
        SEED_DATA.branch.id,
        SEED_DATA.shift.id,
        SEED_DATA.user.id
      ]
    );

    await client.query(
      `INSERT INTO cash_shift_controls (id, tenant_id, branch_id, cash_shift_id, opening_amount_bob, expected_amount_bob, status, opened_by_user_id, opened_at)
       VALUES ($1, $2, $3, $4, '100.0000', '100.0000', 'OPEN', $5, NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'OPEN'`,
      [
        SEED_DATA.shift.controlId,
        SEED_DATA.tenant.id,
        SEED_DATA.branch.id,
        SEED_DATA.shift.id,
        SEED_DATA.user.id
      ]
    );

    await client.query("COMMIT");
    console.log("✅ Seed completed successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
