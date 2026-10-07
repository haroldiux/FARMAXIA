import type { Pool } from "pg";

/**
 * Shared seed helpers for the F18 analytics specs (alerts, dashboard, forecast). Each spec picks its own UUID
 * `base` (990000 + n range) so fixtures never collide with analytics.spec.ts.
 */
export interface SaleLine {
  presentationId: string;
  quantity: number;
  factor: number;
  unitPrice: number;
  unitCostBase: number | null;
}
export interface SaleOptions {
  status?: string;
  /** Whole days before now (default 1). */
  daysAgo?: number;
  /** La Paz calendar day (YYYY-MM-DD) at noon; wins over daysAgo. */
  day?: string;
  tenant?: string;
  /** Creator (must belong to the branch); defaults to the owner user. */
  userId?: string;
}

export function createFixtures(ownerPool: Pool, base: number) {
  const id = (n: number) => `00000000-0000-4000-8000-${String(base + n).padStart(12, "0")}`;
  const ids = {
    tenantId: id(1),
    legalEntityId: id(2),
    branchA: id(11),
    branchB: id(12),
    ownerUser: id(21), // analytics.read, member of A and B
    plainUser: id(23), // no analytics.read, member of A
    warehouseA: id(31),
    warehouseB: id(32),
    registerA: id(41),
    shiftA: id(42),
    registerB: id(43),
    shiftB: id(44),
    productA: id(51),
    productB: id(52),
    productC: id(53),
    productD: id(54),
    productE: id(55),
    pA: id(61), // Caja x 10 (factor 10)
    pB: id(62), // Blister (factor 1)
    pC: id(63), // Unidad, no cost
    pD: id(64), // Unidad, branch B
    pE: id(65), // stock without sales, no cost
    roleAnalytics: id(71),
    roleNone: id(72),
    otherTenantId: id(101),
    otherLegalEntityId: id(102),
    otherBranchId: id(111),
    otherUser: id(121),
    otherWarehouse: id(131),
    otherRegister: id(141),
    otherShift: id(142),
    otherProduct: id(151),
    otherPresentation: id(161)
  };
  let counter = 0;

  async function setPlan(planCode: string, tenant = ids.tenantId): Promise<void> {
    await ownerPool.query("delete from tenant_subscriptions where tenant_id = $1", [tenant]);
    const plan = await ownerPool.query<{ id: string }>("select id from subscription_plans where code = $1", [planCode]);
    await ownerPool.query("insert into tenant_subscriptions (tenant_id, plan_id, status, starts_at) values ($1, $2, 'ACTIVE', now())", [
      tenant,
      plan.rows[0]!.id
    ]);
  }

  async function insertSale(branch: string, shift: string, warehouse: string, lines: SaleLine[], options: SaleOptions = {}): Promise<{ saleId: string; itemIds: string[] }> {
    counter += 1;
    const status = options.status ?? "CONFIRMED";
    const tenant = options.tenant ?? ids.tenantId;
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const sale = await ownerPool.query<{ id: string }>(
      `insert into sales (tenant_id, branch_id, cash_shift_id, warehouse_id, status, total_amount_bob, paid_amount_bob, sale_number,
                          created_by_user_id, created_at, voided_at, voided_by_user_id, void_reason)
       values ($1, $2, $3, $4, $5::varchar, $6, $6, $7, $8,
               case when $10::text is not null then ($10::date + time '12:00') at time zone 'America/La_Paz' else now() - make_interval(days => $9::int) end,
               case when $5::varchar = 'VOIDED' then now() end, case when $5::varchar = 'VOIDED' then $8::uuid end, case when $5::varchar = 'VOIDED' then 'Error' end)
       returning id`,
      [tenant, branch, shift, warehouse, status, total, `F-${base}-${counter}`, options.userId ?? ids.ownerUser, options.daysAgo ?? 1, options.day ?? null]
    );
    const itemIds: string[] = [];
    for (const line of lines) {
      const item = await ownerPool.query<{ id: string }>(
        `insert into sale_items (tenant_id, branch_id, sale_id, presentation_id, quantity, quantity_base, unit_price_bob, line_total_bob, unit_cost_base_bob)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [tenant, branch, sale.rows[0]!.id, line.presentationId, line.quantity, line.quantity * line.factor, line.unitPrice, line.quantity * line.unitPrice, line.unitCostBase]
      );
      itemIds.push(item.rows[0]!.id);
    }
    return { saleId: sale.rows[0]!.id, itemIds };
  }

  async function insertReturn(branch: string, shift: string, saleId: string, itemId: string, quantity: number, factor: number, unitPrice: number, tenant = ids.tenantId): Promise<void> {
    counter += 1;
    const amount = quantity * unitPrice;
    const ret = await ownerPool.query<{ id: string }>(
      `insert into sale_returns (tenant_id, branch_id, sale_id, return_number, refund_method, refund_amount_bob, reason, restock, cash_shift_id, created_by_user_id)
       values ($1, $2, $3, $4, 'CASH', $5, 'Devolución', false, $6, $7) returning id`,
      [tenant, branch, saleId, `R-${base}-${counter}`, amount, shift, ids.ownerUser]
    );
    await ownerPool.query(
      `insert into sale_return_items (tenant_id, branch_id, sale_return_id, sale_item_id, quantity, quantity_base, unit_price_bob, line_total_bob)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenant, branch, ret.rows[0]!.id, itemId, quantity, quantity * factor, unitPrice, amount]
    );
  }

  async function insertStock(
    warehouse: string,
    presentationId: string,
    lot: string,
    quantity: number,
    reserved: number,
    options: { expiresInDays?: number; status?: string; tenant?: string } = {}
  ): Promise<void> {
    const tenant = options.tenant ?? ids.tenantId;
    const batch = await ownerPool.query<{ id: string }>(
      `insert into inventory_batches (tenant_id, presentation_id, lot_code, expires_on, unit_cost, status)
       values ($1, $2, $3, current_date + $4::int, 1.0000, $5) returning id`,
      [tenant, presentationId, lot, options.expiresInDays ?? 300, options.status ?? "AVAILABLE"]
    );
    await ownerPool.query(
      "insert into inventory_balances (tenant_id, warehouse_id, batch_id, quantity_base, reserved_base) values ($1, $2, $3, $4, $5)",
      [tenant, warehouse, batch.rows[0]!.id, quantity, reserved]
    );
  }

  /** Two pharmacies, two branches, users, roles, catalog (5 presentations) and a second pharmacy with one presentation. No sales, no stock. */
  async function seedBase(): Promise<void> {
    await ownerPool.query(
      `insert into permissions (code, description, label, module, sort_order)
       values ('analytics.read', 'Read analytics reports', 'Ver analítica del negocio', 'Analítica', 79)
       on conflict (code) do nothing`
    );
    await ownerPool.query("insert into tenants (id, slug, name) values ($1, $3, 'Farmacia Fixture'), ($2, $4, 'Otra Farmacia')", [
      ids.tenantId,
      ids.otherTenantId,
      `fx-${base}`,
      `fx-other-${base}`
    ]);
    await ownerPool.query("insert into legal_entities (id, tenant_id, legal_name, tax_id) values ($1, $2, 'Fixture SRL', $5), ($3, $4, 'Otra SRL', $6)", [
      ids.legalEntityId,
      ids.tenantId,
      ids.otherLegalEntityId,
      ids.otherTenantId,
      `${base}1`,
      `${base}2`
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $3, $4, 'MAIN', 'Central'), ($2, $3, $4, 'SUR', 'Sur')", [
      ids.branchA,
      ids.branchB,
      ids.tenantId,
      ids.legalEntityId
    ]);
    await ownerPool.query("insert into branches (id, tenant_id, legal_entity_id, code, name) values ($1, $2, $3, 'OTRA', 'Otra')", [
      ids.otherBranchId,
      ids.otherTenantId,
      ids.otherLegalEntityId
    ]);
    await ownerPool.query(
      `insert into users (id, email, display_name, password_hash) values ($1, $4, 'Duena', 'x'), ($2, $5, 'Sin permiso', 'x'), ($3, $6, 'Otra', 'x')`,
      [ids.ownerUser, ids.plainUser, ids.otherUser, `fx-owner-${base}@example.test`, `fx-plain-${base}@example.test`, `fx-other-${base}@example.test`]
    );
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $3, $4), ($1, $3, $5), ($2, $3, $4)", [
      ids.ownerUser,
      ids.plainUser,
      ids.tenantId,
      ids.branchA,
      ids.branchB
    ]);
    await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [ids.otherUser, ids.otherTenantId, ids.otherBranchId]);
    await ownerPool.query("insert into roles (id, tenant_id, code) values ($1, $3, 'analista'), ($2, $3, 'sin-analitica')", [ids.roleAnalytics, ids.roleNone, ids.tenantId]);
    await ownerPool.query("insert into role_permissions (role_id, permission_code) values ($1, 'analytics.read')", [ids.roleAnalytics]);
    await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $3, $4), ($2, $3, $5)", [
      ids.ownerUser,
      ids.plainUser,
      ids.tenantId,
      ids.roleAnalytics,
      ids.roleNone
    ]);
    await ownerPool.query(
      "insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $3, $4, 'Central', 'CENTRAL'), ($2, $3, $5, 'Sur', 'CENTRAL')",
      [ids.warehouseA, ids.warehouseB, ids.tenantId, ids.branchA, ids.branchB]
    );
    await ownerPool.query("insert into warehouses (id, tenant_id, branch_id, name, warehouse_type) values ($1, $2, $3, 'Otra', 'CENTRAL')", [ids.otherWarehouse, ids.otherTenantId, ids.otherBranchId]);
    await ownerPool.query("insert into cash_registers (id, tenant_id, branch_id, code, is_active) values ($1, $3, $4, 'CAJA-1', true), ($2, $3, $5, 'CAJA-2', true), ($6, $7, $8, 'CAJA-3', true)", [
      ids.registerA,
      ids.registerB,
      ids.tenantId,
      ids.branchA,
      ids.branchB,
      ids.otherRegister,
      ids.otherTenantId,
      ids.otherBranchId
    ]);
    await ownerPool.query(
      `insert into cash_shifts (id, tenant_id, branch_id, cash_register_id, scheduled_start_at, scheduled_end_at, status, created_by_user_id)
       values ($1, $5, $6, $2, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $7),
              ($3, $5, $8, $4, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $7),
              ($9, $10, $11, $12, now() - interval '90 days', now() + interval '8 hours', 'SCHEDULED', $13)`,
      [ids.shiftA, ids.registerA, ids.shiftB, ids.registerB, ids.tenantId, ids.branchA, ids.ownerUser, ids.branchB, ids.otherShift, ids.otherTenantId, ids.otherBranchId, ids.otherRegister, ids.otherUser]
    );
    await ownerPool.query(
      `insert into products (id, tenant_id, name, laboratory) values
         ($1, $6, 'Prod A', 'Bago'), ($2, $6, 'Prod B', 'Bago'), ($3, $6, 'Prod C', null), ($4, $6, 'Prod D', 'Vita'), ($5, $6, 'Prod E', 'Vita')`,
      [ids.productA, ids.productB, ids.productC, ids.productD, ids.productE, ids.tenantId]
    );
    await ownerPool.query(
      `insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values
         ($1, $6, $2, 'Caja x 10', 10), ($3, $6, $4, 'Blister', 1), ($5, $6, $7, 'Unidad', 1)`,
      [ids.pA, ids.productA, ids.pB, ids.productB, ids.pC, ids.tenantId, ids.productC]
    );
    await ownerPool.query(`insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $5, $2, 'Unidad', 1), ($3, $5, $4, 'Unidad', 1)`, [
      ids.pD,
      ids.productD,
      ids.pE,
      ids.productE,
      ids.tenantId
    ]);
    await ownerPool.query("insert into products (id, tenant_id, name) values ($1, $2, 'Prod Otra')", [ids.otherProduct, ids.otherTenantId]);
    await ownerPool.query("insert into product_presentations (id, tenant_id, product_id, name, base_unit_factor) values ($1, $2, $3, 'Unidad', 1)", [
      ids.otherPresentation,
      ids.otherTenantId,
      ids.otherProduct
    ]);
    await ownerPool.query("insert into presentation_costs (tenant_id, presentation_id, average_unit_cost, last_unit_cost) values ($1, $2, 2, 2), ($1, $3, 3, 3), ($1, $4, 1, 1)", [
      ids.tenantId,
      ids.pA,
      ids.pB,
      ids.pD
    ]);
  }

  return { ids, id, setPlan, insertSale, insertReturn, insertStock, seedBase, resetCounter: () => (counter = 0) };
}

export type Fixtures = ReturnType<typeof createFixtures>;
