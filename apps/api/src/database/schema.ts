import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = timestamp("created_at", {
  withTimezone: true
}).defaultNow().notNull();

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)]
);

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    allowsAllFeatures: boolean("allows_all_features").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [uniqueIndex("subscription_plans_code_unique").on(table.code)]
);

export const planFeatures = pgTable(
  "plan_features",
  {
    planId: uuid("plan_id").notNull(),
    featureCode: varchar("feature_code", { length: 120 }).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull()
  },
  (table) => [
    primaryKey({
      name: "plan_features_pk",
      columns: [table.planId, table.featureCode]
    }),
    foreignKey({
      name: "plan_features_plan_fk",
      columns: [table.planId],
      foreignColumns: [subscriptionPlans.id]
    })
  ]
);

export const planQuotas = pgTable(
  "plan_quotas",
  {
    planId: uuid("plan_id").notNull(),
    resourceCode: varchar("resource_code", { length: 80 }).notNull(),
    limitUnits: bigint("limit_units", { mode: "number" })
  },
  (table) => [
    primaryKey({
      name: "plan_quotas_pk",
      columns: [table.planId, table.resourceCode]
    }),
    foreignKey({
      name: "plan_quotas_plan_fk",
      columns: [table.planId],
      foreignColumns: [subscriptionPlans.id]
    }),
    check("plan_quotas_non_negative_check", sql`${table.limitUnits} is null or ${table.limitUnits} >= 0`)
  ]
);

export const tenantSubscriptions = pgTable(
  "tenant_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    planId: uuid("plan_id").notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      name: "tenant_subscriptions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "tenant_subscriptions_plan_fk",
      columns: [table.planId],
      foreignColumns: [subscriptionPlans.id]
    }),
    unique("tenant_subscriptions_tenant_id_id_unique").on(table.tenantId, table.id),
    uniqueIndex("tenant_subscriptions_one_current_per_tenant").on(table.tenantId).where(
      sql`${table.status} <> 'CANCELED'`
    ),
    check(
      "tenant_subscriptions_status_check",
      sql`${table.status} in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED')`
    )
  ]
);

export const subscriptionQuotaOverrides = pgTable(
  "subscription_quota_overrides",
  {
    subscriptionId: uuid("subscription_id").notNull(),
    resourceCode: varchar("resource_code", { length: 80 }).notNull(),
    limitUnits: bigint("limit_units", { mode: "number" })
  },
  (table) => [
    primaryKey({
      name: "subscription_quota_overrides_pk",
      columns: [table.subscriptionId, table.resourceCode]
    }),
    foreignKey({
      name: "subscription_quota_overrides_subscription_fk",
      columns: [table.subscriptionId],
      foreignColumns: [tenantSubscriptions.id]
    }),
    check(
      "subscription_quota_overrides_non_negative_check",
      sql`${table.limitUnits} is null or ${table.limitUnits} >= 0`
    )
  ]
);

export const tenantResourceUsage = pgTable(
  "tenant_resource_usage",
  {
    tenantId: uuid("tenant_id").notNull(),
    resourceCode: varchar("resource_code", { length: 80 }).notNull(),
    usedUnits: bigint("used_units", { mode: "number" }).default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({
      name: "tenant_resource_usage_pk",
      columns: [table.tenantId, table.resourceCode]
    }),
    foreignKey({
      name: "tenant_resource_usage_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    check("tenant_resource_usage_non_negative_check", sql`${table.usedUnits} >= 0`)
  ]
);

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    taxId: varchar("tax_id", { length: 32 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "legal_entities_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    unique("legal_entities_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("legal_entities_tenant_tax_id_unique").on(table.tenantId, table.taxId)
  ]
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "branches_tenant_legal_entity_fk",
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id]
    }),
    unique("branches_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("branches_tenant_code_unique").on(table.tenantId, table.code)
  ]
);

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    isDispatchEnabled: boolean("is_dispatch_enabled").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "warehouses_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    unique("warehouses_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("warehouses_tenant_branch_name_unique").on(
      table.tenantId,
      table.branchId,
      table.name
    )
  ]
);

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "cash_registers_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    unique("cash_registers_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("cash_registers_tenant_branch_code_unique").on(
      table.tenantId,
      table.branchId,
      table.code
    )
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
);

export const userBranchMemberships = pgTable(
  "user_branch_memberships",
  {
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({
      name: "user_branch_memberships_pk",
      columns: [table.userId, table.tenantId, table.branchId]
    }),
    foreignKey({
      name: "user_branch_memberships_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id]
    }),
    foreignKey({
      name: "user_branch_memberships_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    })
  ]
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "roles_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    unique("roles_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("roles_tenant_code_unique").on(table.tenantId, table.code)
  ]
);

export const permissions = pgTable("permissions", {
  code: varchar("code", { length: 120 }).primaryKey(),
  description: varchar("description", { length: 255 }).notNull()
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull(),
    permissionCode: varchar("permission_code", { length: 120 }).notNull()
  },
  (table) => [
    primaryKey({
      name: "role_permissions_pk",
      columns: [table.roleId, table.permissionCode]
    }),
    foreignKey({
      name: "role_permissions_role_fk",
      columns: [table.roleId],
      foreignColumns: [roles.id]
    }),
    foreignKey({
      name: "role_permissions_permission_fk",
      columns: [table.permissionCode],
      foreignColumns: [permissions.code]
    })
  ]
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    roleId: uuid("role_id").notNull(),
    createdAt
  },
  (table) => [
    primaryKey({
      name: "user_roles_pk",
      columns: [table.userId, table.tenantId, table.roleId]
    }),
    foreignKey({
      name: "user_roles_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id]
    }),
    foreignKey({
      name: "user_roles_tenant_role_fk",
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id]
    })
  ]
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    foreignKey({
      name: "auth_sessions_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id]
    }),
    foreignKey({
      name: "auth_sessions_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    })
  ]
);

export const tenantFiles = pgTable(
  "tenant_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    storageKey: varchar("storage_key", { length: 700 }).notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "tenant_files_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    unique("tenant_files_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("tenant_files_tenant_branch_id_unique").on(
      table.tenantId,
      table.branchId,
      table.id
    ),
    uniqueIndex("tenant_files_storage_key_unique").on(table.storageKey),
    check(
      "tenant_files_storage_key_scope_check",
      sql`${table.storageKey} like ('tenants/' || ${table.tenantId}::text || '/branches/' || ${table.branchId}::text || '/files/%')`
    )
  ]
);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    kind: varchar("kind", { length: 80 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    payload: jsonb("payload").notNull(),
    resultFileId: uuid("result_file_id"),
    createdAt,
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => [
    foreignKey({
      name: "background_jobs_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    foreignKey({
      name: "background_jobs_tenant_branch_file_fk",
      columns: [table.tenantId, table.branchId, table.resultFileId],
      foreignColumns: [tenantFiles.tenantId, tenantFiles.branchId, tenantFiles.id]
    }),
    index("background_jobs_tenant_branch_status_created_at_idx").on(
      table.tenantId,
      table.branchId,
      table.status,
      table.createdAt
    )
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: varchar("entity_id", { length: 100 }).notNull(),
    payload: jsonb("payload").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      name: "audit_events_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    foreignKey({
      name: "audit_events_actor_user_fk",
      columns: [table.actorUserId],
      foreignColumns: [users.id]
    }),
    unique("audit_events_tenant_id_id_unique").on(table.tenantId, table.id),
    index("audit_events_tenant_branch_occurred_at_idx").on(
      table.tenantId,
      table.branchId,
      table.occurredAt
    )
  ]
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    userId: uuid("user_id").notNull(),
    operation: varchar("operation", { length: 100 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    statusCode: integer("status_code").notNull(),
    responsePayload: jsonb("response_payload").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "idempotency_records_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    foreignKey({
      name: "idempotency_records_user_fk",
      columns: [table.userId],
      foreignColumns: [users.id]
    }),
    uniqueIndex("idempotency_records_tenant_op_key_unique").on(
      table.tenantId,
      table.operation,
      table.idempotencyKey
    )
  ]
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
    aggregateId: varchar("aggregate_id", { length: 100 }).notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: varchar("status", { length: 20 }).default("PENDING").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "outbox_events_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    index("outbox_events_tenant_branch_status_scheduled_idx").on(
      table.tenantId,
      table.branchId,
      table.status,
      table.scheduledFor
    )
  ]
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    documentType: varchar("document_type", { length: 50 }).notNull(),
    currentNumber: bigint("current_number", { mode: "bigint" }).default(sql`0`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      name: "document_sequences_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    uniqueIndex("document_sequences_tenant_branch_type_unique").on(
      table.tenantId,
      table.branchId,
      table.documentType
    )
  ]
);

export const productCategories = pgTable(
  "product_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    isControlled: boolean("is_controlled").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "product_categories_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    unique("product_categories_tenant_name_unique").on(table.tenantId, table.name),
    unique("product_categories_tenant_id_unique").on(table.tenantId, table.id)
  ]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    categoryId: uuid("category_id"),
    name: varchar("name", { length: 200 }).notNull(),
    activeIngredient: varchar("active_ingredient", { length: 240 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "products_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "products_tenant_category_fk",
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [productCategories.tenantId, productCategories.id]
    }),
    unique("products_tenant_id_unique").on(table.tenantId, table.id)
  ]
);

export const productPresentations = pgTable(
  "product_presentations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    baseUnitFactor: bigint("base_unit_factor", { mode: "number" }).notNull(),
    isSellable: boolean("is_sellable").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "product_presentations_tenant_product_fk",
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id]
    }),
    unique("product_presentations_tenant_id_unique").on(table.tenantId, table.id),
    unique("product_presentations_tenant_product_name_unique").on(
      table.tenantId,
      table.productId,
      table.name
    ),
    check("product_presentations_factor_positive_check", sql`${table.baseUnitFactor} > 0`)
  ]
);

export const productBarcodes = pgTable(
  "product_barcodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    presentationId: uuid("presentation_id").notNull(),
    barcode: varchar("barcode", { length: 80 }).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "product_barcodes_tenant_presentation_fk",
      columns: [table.tenantId, table.presentationId],
      foreignColumns: [productPresentations.tenantId, productPresentations.id]
    }),
    unique("product_barcodes_tenant_id_unique").on(table.tenantId, table.id),
    unique("product_barcodes_tenant_barcode_unique").on(table.tenantId, table.barcode)
  ]
);

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    branchId: uuid("branch_id"),
    name: varchar("name", { length: 120 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "price_lists_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "price_lists_tenant_branch_fk",
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id]
    }),
    unique("price_lists_tenant_id_unique").on(table.tenantId, table.id),
    unique("price_lists_tenant_name_unique").on(table.tenantId, table.name),
    check("price_lists_currency_format_check", sql`${table.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const presentationPrices = pgTable(
  "presentation_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    presentationId: uuid("presentation_id").notNull(),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "presentation_prices_tenant_price_list_fk",
      columns: [table.tenantId, table.priceListId],
      foreignColumns: [priceLists.tenantId, priceLists.id]
    }),
    foreignKey({
      name: "presentation_prices_tenant_presentation_fk",
      columns: [table.tenantId, table.presentationId],
      foreignColumns: [productPresentations.tenantId, productPresentations.id]
    }),
    unique("presentation_prices_tenant_id_unique").on(table.tenantId, table.id),
    check("presentation_prices_amount_non_negative_check", sql`${table.amount} >= 0`),
    check(
      "presentation_prices_valid_range_check",
      sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`
    )
  ]
);

export const productHomologations = pgTable(
  "product_homologations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    authority: varchar("authority", { length: 80 }).notNull(),
    externalCode: varchar("external_code", { length: 120 }).notNull(),
    externalDescription: varchar("external_description", { length: 255 }),
    status: varchar("status", { length: 24 }).default("PENDING").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "product_homologations_tenant_product_fk",
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id]
    }),
    unique("product_homologations_tenant_id_unique").on(table.tenantId, table.id),
    unique("product_homologations_tenant_authority_code_unique").on(
      table.tenantId,
      table.authority,
      table.externalCode
    )
  ]
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    taxId: varchar("tax_id", { length: 32 }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "suppliers_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    unique("suppliers_tenant_id_unique").on(table.tenantId, table.id),
    unique("suppliers_tenant_name_unique").on(table.tenantId, table.name)
  ]
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    status: varchar("status", { length: 24 }).default("DRAFT").notNull(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "purchase_orders_tenant_supplier_fk",
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id]
    }),
    foreignKey({
      name: "purchase_orders_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    unique("purchase_orders_tenant_id_unique").on(table.tenantId, table.id)
  ]
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    presentationId: uuid("presentation_id").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }).notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "purchase_order_items_tenant_order_fk",
      columns: [table.tenantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id]
    }),
    foreignKey({
      name: "purchase_order_items_tenant_presentation_fk",
      columns: [table.tenantId, table.presentationId],
      foreignColumns: [productPresentations.tenantId, productPresentations.id]
    }),
    unique("purchase_order_items_tenant_id_unique").on(table.tenantId, table.id),
    check("purchase_order_items_quantity_positive_check", sql`${table.quantityBase} > 0`),
    check("purchase_order_items_cost_non_negative_check", sql`${table.unitCost} >= 0`)
  ]
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    status: varchar("status", { length: 24 }).default("POSTED").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "goods_receipts_tenant_order_fk",
      columns: [table.tenantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id]
    }),
    foreignKey({
      name: "goods_receipts_tenant_supplier_fk",
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id]
    }),
    foreignKey({
      name: "goods_receipts_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    unique("goods_receipts_tenant_id_unique").on(table.tenantId, table.id),
    unique("goods_receipts_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey)
  ]
);

export const inventoryBatches = pgTable(
  "inventory_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    presentationId: uuid("presentation_id").notNull(),
    supplierId: uuid("supplier_id"),
    lotCode: varchar("lot_code", { length: 100 }).notNull(),
    expiresOn: date("expires_on").notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
    status: varchar("status", { length: 24 }).default("AVAILABLE").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "inventory_batches_tenant_presentation_fk",
      columns: [table.tenantId, table.presentationId],
      foreignColumns: [productPresentations.tenantId, productPresentations.id]
    }),
    foreignKey({
      name: "inventory_batches_tenant_supplier_fk",
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id]
    }),
    unique("inventory_batches_tenant_id_unique").on(table.tenantId, table.id),
    unique("inventory_batches_tenant_presentation_lot_unique").on(
      table.tenantId,
      table.presentationId,
      table.lotCode
    ),
    check("inventory_batches_cost_non_negative_check", sql`${table.unitCost} >= 0`)
  ]
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    goodsReceiptId: uuid("goods_receipt_id").notNull(),
    presentationId: uuid("presentation_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }).notNull(),
    unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "goods_receipt_items_tenant_receipt_fk",
      columns: [table.tenantId, table.goodsReceiptId],
      foreignColumns: [goodsReceipts.tenantId, goodsReceipts.id]
    }),
    foreignKey({
      name: "goods_receipt_items_tenant_presentation_fk",
      columns: [table.tenantId, table.presentationId],
      foreignColumns: [productPresentations.tenantId, productPresentations.id]
    }),
    foreignKey({
      name: "goods_receipt_items_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [inventoryBatches.tenantId, inventoryBatches.id]
    }),
    unique("goods_receipt_items_tenant_id_unique").on(table.tenantId, table.id),
    check("goods_receipt_items_quantity_positive_check", sql`${table.quantityBase} > 0`),
    check("goods_receipt_items_cost_non_negative_check", sql`${table.unitCost} >= 0`)
  ]
);

export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    tenantId: uuid("tenant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }).default(0).notNull(),
    reservedBase: bigint("reserved_base", { mode: "number" }).default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ name: "inventory_balances_pk", columns: [table.tenantId, table.warehouseId, table.batchId] }),
    foreignKey({
      name: "inventory_balances_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    foreignKey({
      name: "inventory_balances_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [inventoryBatches.tenantId, inventoryBatches.id]
    }),
    check("inventory_balances_quantity_non_negative_check", sql`${table.quantityBase} >= 0`),
    check("inventory_balances_reserved_non_negative_check", sql`${table.reservedBase} >= 0`)
  ]
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    movementType: varchar("movement_type", { length: 24 }).notNull(),
    movementDirection: varchar("movement_direction", { length: 3 }).default("IN").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }).notNull(),
    referenceType: varchar("reference_type", { length: 80 }).notNull(),
    referenceId: uuid("reference_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      name: "inventory_movements_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    foreignKey({
      name: "inventory_movements_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [inventoryBatches.tenantId, inventoryBatches.id]
    }),
    index("inventory_movements_tenant_warehouse_occurred_idx").on(
      table.tenantId,
      table.warehouseId,
      table.occurredAt
    ),
    check("inventory_movements_quantity_positive_check", sql`${table.quantityBase} > 0`),
    check("inventory_movements_direction_check", sql`${table.movementDirection} in ('IN', 'OUT')`)
  ]
);

export const inventoryReconciliations = pgTable(
  "inventory_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    expectedQuantity: bigint("expected_quantity", { mode: "number" }).notNull(),
    countedQuantity: bigint("counted_quantity", { mode: "number" }).notNull(),
    deltaQuantity: bigint("delta_quantity", { mode: "number" }).notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    status: varchar("status", { length: 24 }).default("POSTED").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "inventory_reconciliations_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    foreignKey({
      name: "inventory_reconciliations_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [inventoryBatches.tenantId, inventoryBatches.id]
    }),
    unique("inventory_reconciliations_tenant_id_unique").on(table.tenantId, table.id),
    unique("inventory_reconciliations_tenant_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    check("inventory_reconciliations_expected_non_negative_check", sql`${table.expectedQuantity} >= 0`),
    check("inventory_reconciliations_counted_non_negative_check", sql`${table.countedQuantity} >= 0`)
  ]
);

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 24 }).default("ACTIVE").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "inventory_reservations_tenant_warehouse_fk",
      columns: [table.tenantId, table.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id]
    }),
    foreignKey({
      name: "inventory_reservations_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [inventoryBatches.tenantId, inventoryBatches.id]
    }),
    unique("inventory_reservations_tenant_id_unique").on(table.tenantId, table.id),
    index("inventory_reservations_tenant_warehouse_status_expiry_idx").on(
      table.tenantId,
      table.warehouseId,
      table.status,
      table.expiresAt
    ),
    check("inventory_reservations_quantity_positive_check", sql`${table.quantityBase} > 0`),
    check(
      "inventory_reservations_status_check",
      sql`${table.status} in ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')`
    )
  ]
);

export const supplierInvoices = pgTable(
  "supplier_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    goodsReceiptId: uuid("goods_receipt_id"),
    invoiceNumber: varchar("invoice_number", { length: 80 }).notNull(),
    issuedOn: date("issued_on").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 18, scale: 4 }).notNull(),
    status: varchar("status", { length: 24 }).default("OPEN").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "supplier_invoices_tenant_supplier_fk",
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id]
    }),
    foreignKey({
      name: "supplier_invoices_tenant_receipt_fk",
      columns: [table.tenantId, table.goodsReceiptId],
      foreignColumns: [goodsReceipts.tenantId, goodsReceipts.id]
    }),
    unique("supplier_invoices_tenant_id_unique").on(table.tenantId, table.id),
    unique("supplier_invoices_tenant_supplier_number_unique").on(
      table.tenantId,
      table.supplierId,
      table.invoiceNumber
    ),
    check("supplier_invoices_amount_non_negative_check", sql`${table.totalAmount} >= 0`)
  ]
);

export const payables = pgTable(
  "payables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    supplierInvoiceId: uuid("supplier_invoice_id").notNull(),
    dueOn: date("due_on").notNull(),
    originalAmount: numeric("original_amount", { precision: 18, scale: 4 }).notNull(),
    outstandingAmount: numeric("outstanding_amount", { precision: 18, scale: 4 }).notNull(),
    status: varchar("status", { length: 24 }).default("OPEN").notNull(),
    createdAt
  },
  (table) => [
    foreignKey({
      name: "payables_tenant_invoice_fk",
      columns: [table.tenantId, table.supplierInvoiceId],
      foreignColumns: [supplierInvoices.tenantId, supplierInvoices.id]
    }),
    unique("payables_tenant_id_unique").on(table.tenantId, table.id),
    unique("payables_tenant_invoice_unique").on(table.tenantId, table.supplierInvoiceId),
    check("payables_original_amount_non_negative_check", sql`${table.originalAmount} >= 0`),
    check("payables_outstanding_amount_non_negative_check", sql`${table.outstandingAmount} >= 0`)
  ]
);
