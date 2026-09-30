import fastifyCookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";
import { PasswordHasher } from "../src/auth/password-hasher.js";
import { TenantDatabase } from "../src/database/tenant-database.js";
import { AuditLogService } from "../src/saas/audit-log.service.js";
import { BillingService } from "../src/saas/billing.service.js";
import { OnboardingService, type RegisterPharmacyInput } from "../src/saas/onboarding.service.js";
import { PlatformTokenService } from "../src/saas/platform-auth.js";
import { PlatformDatabase } from "../src/saas/platform-database.js";
import { PlatformService } from "../src/saas/platform.service.js";
import { TenantBillingService } from "../src/saas/tenant-billing.service.js";
import { FeatureService } from "../src/subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../src/subscriptions/quota.service.js";

function withDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const role = (name: string) =>
  withDatabaseName(`postgresql://${name}:local-development-only@localhost:5433/farmaxia`, "farmaxia_test");
const testOwnerUrl =
  process.env.DATABASE_TEST_URL ??
  withDatabaseName(process.env.DATABASE_URL ?? "postgresql://farmaxia:local-development-only@localhost:5433/farmaxia", "farmaxia_test");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const platformDatabase = new PlatformDatabase(testPlatformUrl);
const tenantDatabase = new TenantDatabase(testAppUrl);
const hasher = new PasswordHasher();
const billing = new BillingService(platformDatabase);
const onboarding = new OnboardingService(platformDatabase, hasher, billing);
const tenantBilling = new TenantBillingService(tenantDatabase);
const auditLog = new AuditLogService(tenantDatabase);
const platformTokens = new PlatformTokenService();
const platform = new PlatformService(platformDatabase, hasher, platformTokens);
const features = new FeatureService(tenantDatabase);

const day = 24 * 60 * 60 * 1000;
const start = new Date("2026-10-01T12:00:00.000Z");
const operatorId = "00000000-0000-4000-8000-000000000901";

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";

function pharmacy(overrides: Partial<RegisterPharmacyInput> = {}): RegisterPharmacyInput {
  return {
    pharmacyName: "Farmacia Santa Cruz",
    legalName: "Farmacia Santa Cruz S.R.L.",
    taxId: "1234567019",
    ownerName: "Ana Rojas",
    email: `ana.${Math.random().toString(36).slice(2, 8)}@farmacia.bo`,
    password: "ClaveSegura123",
    planCode: "BASICO",
    ...overrides
  };
}

async function registerAt(now: Date, overrides: Partial<RegisterPharmacyInput> = {}) {
  const registered = await onboarding.register(pharmacy(overrides), now);
  return { ...registered, scope: { tenantId: registered.tenantId, branchId: registered.branchId, userId: registered.userId } };
}

async function subscriptionOf(tenantId: string) {
  const { rows } = await ownerPool.query<{ status: string; currentPeriodEnd: Date | null; graceEndsAt: Date | null; planCode: string }>(
    `select subscription.status, subscription.current_period_end as "currentPeriodEnd",
            subscription.grace_ends_at as "graceEndsAt", plan.code as "planCode"
     from tenant_subscriptions as subscription
     join subscription_plans as plan on plan.id = subscription.plan_id
     where subscription.tenant_id = $1 and subscription.status <> 'CANCELED'`,
    [tenantId]
  );
  return rows[0];
}

async function invoicesOf(tenantId: string) {
  const { rows } = await ownerPool.query<{ id: string; status: string; amountBob: string; periodStart: Date; periodEnd: Date; number: string }>(
    `select id, status, amount_bob::text as "amountBob", period_start as "periodStart", period_end as "periodEnd", number
     from saas_invoices where tenant_id = $1 order by period_start, issued_at`,
    [tenantId]
  );
  return rows;
}

async function payInvoice(scope: { tenantId: string; branchId: string; userId: string }, invoiceId: string, amountBob: string) {
  const { paymentId } = await tenantBilling.submitPayment(scope, invoiceId, {
    method: "QR",
    reference: "QR-0001",
    amountBob,
    paidOn: "2026-09-20"
  });
  return paymentId;
}

describe("Core SaaS", () => {
  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        saas_payments, saas_invoices, subscription_feature_overrides, platform_audit_events, platform_operators,
        audit_events, idempotency_records, outbox_events, document_sequences,
        subscription_quota_overrides, tenant_resource_usage, tenant_subscriptions,
        background_jobs, tenant_files, auth_sessions, user_roles, role_permissions, roles,
        user_branch_memberships, cash_shift_controls, cash_shift_users, cash_shifts, cash_registers,
        warehouses, branches, legal_entities, users, tenants
      cascade
    `);
    await ownerPool.query(
      `insert into platform_operators (id, email, display_name, password_hash)
       values ($1, 'ops@farmaxia.bo', 'Operador', $2)`,
      [operatorId, await hasher.hash("OperadorSeguro123")]
    );
  });

  afterAll(async () => {
    await Promise.all([ownerPool.end(), platformDatabase.close(), tenantDatabase.close()]);
  });

  describe("planes", () => {
    it("publica Básico, Profesional y Premium con los límites de la matriz comercial", async () => {
      const plans = await onboarding.listPublicPlans();
      expect(plans.map((plan) => plan.code)).toEqual(["BASICO", "PROFESIONAL", "PREMIUM"]);
      const [basico, profesional, premium] = plans;
      expect(basico?.quotas).toMatchObject({ branches: 1, cash_registers: 1, users: 2 });
      expect(profesional?.quotas).toMatchObject({ branches: 3, cash_registers: 4, users: 8 });
      expect(premium?.quotas).toMatchObject({ branches: null, cash_registers: null, users: null });
      expect(basico?.auditRetentionDays).toBe(7);
      expect(premium?.auditRetentionDays).toBeNull();
      expect(basico?.features).not.toContain("siat");
      expect(profesional?.features).toContain("siat");
      expect(premium?.features).toContain("public_api");
    });
  });

  describe("alta de farmacias", () => {
    it("crea la farmacia completa con 7 días de prueba y su primer comprobante", async () => {
      const registered = await registerAt(start);

      expect(registered.trialEndsAt.toISOString()).toBe(new Date(start.getTime() + 7 * day).toISOString());
      const structure = await ownerPool.query(
        `select
           (select count(*)::int from branches where tenant_id = $1) as branches,
           (select count(*)::int from warehouses where tenant_id = $1) as warehouses,
           (select count(*)::int from cash_registers where tenant_id = $1) as registers,
           (select count(*)::int from user_branch_memberships where tenant_id = $1) as members,
           (select count(*)::int from role_permissions join roles on roles.id = role_permissions.role_id
              where roles.tenant_id = $1 and roles.code = 'owner') as permissions,
           (select count(*)::int from roles where tenant_id = $1 and is_system) as roles,
           (select count(*)::int from audit_events where tenant_id = $1 and action = 'tenant.registered') as audits`,
        [registered.tenantId]
      );
      expect(structure.rows[0]).toEqual({ branches: 1, warehouses: 1, registers: 1, members: 1, permissions: 11, roles: 5, audits: 1 });
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "TRIALING", planCode: "BASICO" });

      const invoices = await invoicesOf(registered.tenantId);
      expect(invoices).toHaveLength(1);
      expect(invoices[0]).toMatchObject({ status: "OPEN", amountBob: "150.00", number: expect.stringMatching(/^FX-\d{6}$/) });
      expect(invoices[0]?.periodStart.toISOString()).toBe(registered.trialEndsAt.toISOString());
    });

    it("rechaza correo repetido, contraseña débil y plan inexistente sin crear nada", async () => {
      const first = await registerAt(start, { email: "dueno@farmacia.bo" });
      await expect(onboarding.register(pharmacy({ email: "DUENO@farmacia.bo" }), start)).rejects.toMatchObject({ status: 409 });
      await expect(onboarding.register(pharmacy({ password: "corta1" }), start)).rejects.toMatchObject({ status: 400 });
      await expect(onboarding.register(pharmacy({ planCode: "COMPLETO" }), start)).rejects.toMatchObject({ status: 400 });
      await expect(onboarding.register(pharmacy({ taxId: "12AB45" }), start)).rejects.toMatchObject({ status: 400 });

      const tenants = await ownerPool.query("select id from tenants");
      expect(tenants.rows.map((row) => row.id)).toEqual([first.tenantId]);
    });

    it("genera un identificador único cuando dos farmacias tienen el mismo nombre", async () => {
      const first = await registerAt(start);
      const second = await registerAt(start);
      expect(first.tenantSlug).toBe("farmacia-santa-cruz");
      expect(second.tenantSlug).toBe("farmacia-santa-cruz-2");
    });
  });

  describe("suscripción y pagos de la farmacia", () => {
    it("muestra plan, uso y funcionalidades, y acepta un solo pago en revisión por comprobante", async () => {
      const registered = await registerAt(new Date());
      const summary = await tenantBilling.summary(registered.scope);
      expect(summary).toMatchObject({ status: "TRIALING", hasAccess: true, plan: { code: "BASICO" }, openInvoices: 1 });
      expect(summary.usage).toContainEqual({ resource: "branches", used: 1, limit: 1 });
      expect(summary.features.find((feature) => feature.code === "siat")?.enabled).toBe(false);

      const [invoice] = await tenantBilling.listInvoices(registered.scope);
      expect(invoice).toBeDefined();
      await payInvoice(registered.scope, invoice!.id, "150.00");
      await expect(payInvoice(registered.scope, invoice!.id, "150.00")).rejects.toMatchObject({ status: 409 });

      const [withPayment] = await tenantBilling.listInvoices(registered.scope);
      expect(withPayment?.payments).toHaveLength(1);
      expect(withPayment?.payments[0]).toMatchObject({ status: "PENDING", method: "QR", hasAttachment: false });
    });

    it("valida el pago declarado y guarda el comprobante adjunto", async () => {
      const registered = await registerAt(new Date());
      const [invoice] = await tenantBilling.listInvoices(registered.scope);
      const invalid = [
        { method: "CASH", reference: "ABC", amountBob: "150", paidOn: "2026-10-01" },
        { method: "QR", reference: "", amountBob: "150", paidOn: "2026-10-01" },
        { method: "QR", reference: "ABC", amountBob: "-1", paidOn: "2026-10-01" },
        { method: "QR", reference: "ABC", amountBob: "150", paidOn: "ayer" },
        { method: "QR", reference: "ABC", amountBob: "150", paidOn: "2026-10-01", attachment: { mediaType: "text/html", base64: "PGgxPg==" } }
      ];
      for (const input of invalid) {
        await expect(tenantBilling.submitPayment(registered.scope, invoice!.id, input as never)).rejects.toMatchObject({ status: 400 });
      }

      const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
      const { paymentId } = await tenantBilling.submitPayment(registered.scope, invoice!.id, {
        method: "TRANSFER", reference: "TRX-99", amountBob: "150.00", paidOn: "2026-09-20",
        attachment: { mediaType: "image/png", base64: png }
      });
      const file = await platform.paymentAttachment(paymentId);
      expect(file.mediaType).toBe("image/png");
      expect(file.data.toString("hex")).toBe("89504e470d0a1a0a");
    });

    it("aísla comprobantes y pagos entre farmacias", async () => {
      const a = await registerAt(new Date(), { pharmacyName: "Farmacia A" });
      const b = await registerAt(new Date(), { pharmacyName: "Farmacia B" });
      const [invoiceB] = await invoicesOf(b.tenantId);

      expect((await tenantBilling.listInvoices(a.scope)).map((invoice) => invoice.id)).not.toContain(invoiceB!.id);
      await expect(tenantBilling.invoiceDocument(a.scope, invoiceB!.id)).rejects.toMatchObject({ status: 404 });
      await expect(payInvoice(a.scope, invoiceB!.id, "150.00")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("aprobación de pagos", () => {
    it("aprobar activa la suscripción hasta el fin del periodo pagado", async () => {
      const registered = await registerAt(start);
      const [invoice] = await invoicesOf(registered.tenantId);
      const paymentId = await payInvoice(registered.scope, invoice!.id, "150.00");

      await billing.approvePayment(operatorId, paymentId, "Verificado en banco", new Date(start.getTime() + day));

      const subscription = await subscriptionOf(registered.tenantId);
      expect(subscription?.status).toBe("ACTIVE");
      expect(subscription?.currentPeriodEnd?.toISOString()).toBe(invoice!.periodEnd.toISOString());
      expect((await invoicesOf(registered.tenantId))[0]).toMatchObject({ status: "PAID" });
      await expect(billing.approvePayment(operatorId, paymentId, undefined)).rejects.toMatchObject({ status: 409 });

      const history = await ownerPool.query("select action from platform_audit_events where tenant_id = $1", [registered.tenantId]);
      expect(history.rows.map((row) => row.action)).toContain("saas.payment.approved");
    });

    it("no aprueba un monto menor y exige motivo al rechazar", async () => {
      const registered = await registerAt(start);
      const [invoice] = await invoicesOf(registered.tenantId);
      const paymentId = await payInvoice(registered.scope, invoice!.id, "100.00");

      await expect(billing.approvePayment(operatorId, paymentId, undefined)).rejects.toMatchObject({ status: 409 });
      await expect(billing.rejectPayment(operatorId, paymentId, "  ")).rejects.toMatchObject({ status: 400 });
      await billing.rejectPayment(operatorId, paymentId, "El monto no coincide");

      const [rejected] = await tenantBilling.listInvoices(registered.scope);
      expect(rejected?.status).toBe("OPEN");
      expect(rejected?.payments[0]).toMatchObject({ status: "REJECTED", reviewNote: "El monto no coincide" });
      // Con el pago rechazado, la farmacia puede declarar uno nuevo.
      await payInvoice(registered.scope, invoice!.id, "150.00");
    });
  });

  describe("ciclo de cobro", () => {
    it("suspende una prueba vencida sin pago y bloquea el acceso", async () => {
      const registered = await registerAt(start);
      const afterTrial = new Date(start.getTime() + 7 * day + 60_000);

      expect(await billing.runCycle(afterTrial)).toMatchObject({ suspended: 1 });
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "SUSPENDED" });
      await expect(features.isEnabled(registered.scope, "catalog")).rejects.toBeInstanceOf(SubscriptionAccessError);
    });

    it("emite el siguiente comprobante, pasa a mora sin pago y suspende al terminar la gracia", async () => {
      const registered = await registerAt(start);
      const [first] = await invoicesOf(registered.tenantId);
      await billing.approvePayment(operatorId, await payInvoice(registered.scope, first!.id, "150.00"), undefined, start);
      const paidThrough = first!.periodEnd;

      // Siete días antes del fin del periodo se emite el comprobante siguiente, una sola vez.
      const weekBefore = new Date(paidThrough.getTime() - 7 * day);
      expect(await billing.runCycle(weekBefore)).toEqual({ invoicesIssued: 1, movedToPastDue: 0, suspended: 0 });
      expect(await billing.runCycle(weekBefore)).toEqual({ invoicesIssued: 0, movedToPastDue: 0, suspended: 0 });
      const invoices = await invoicesOf(registered.tenantId);
      expect(invoices).toHaveLength(2);
      expect(invoices[1]?.periodStart.toISOString()).toBe(paidThrough.toISOString());

      const overdue = new Date(paidThrough.getTime() + 60_000);
      expect(await billing.runCycle(overdue)).toMatchObject({ movedToPastDue: 1 });
      const pastDue = await subscriptionOf(registered.tenantId);
      expect(pastDue?.status).toBe("PAST_DUE");
      expect(pastDue?.graceEndsAt?.toISOString()).toBe(new Date(overdue.getTime() + 3 * day).toISOString());
      // Durante la gracia la farmacia sigue operando.
      await expect(features.isEnabled(registered.scope, "catalog")).resolves.toBe(true);

      expect(await billing.runCycle(new Date(overdue.getTime() + 3 * day + 60_000))).toMatchObject({ suspended: 1 });
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "SUSPENDED" });
    });

    it("al pagar estando suspendida reactiva la farmacia desde el día del pago", async () => {
      const registered = await registerAt(start);
      await billing.runCycle(new Date(start.getTime() + 8 * day));
      const [invoice] = await invoicesOf(registered.tenantId);
      const paidAt = new Date(start.getTime() + 10 * day);

      await billing.approvePayment(operatorId, await payInvoice(registered.scope, invoice!.id, "150.00"), undefined, paidAt);

      const subscription = await subscriptionOf(registered.tenantId);
      expect(subscription?.status).toBe("ACTIVE");
      expect(subscription?.currentPeriodEnd?.toISOString()).toBe("2026-11-11T12:00:00.000Z");
    });

    it("no cobra los planes sin costo", async () => {
      const registered = await registerAt(start);
      await ownerPool.query(
        "update tenant_subscriptions set plan_id = (select id from subscription_plans where code = 'COMPLETO'), status = 'ACTIVE', trial_ends_at = null where tenant_id = $1",
        [registered.tenantId]
      );
      await ownerPool.query("update saas_invoices set status = 'VOID' where tenant_id = $1", [registered.tenantId]);

      expect(await billing.runCycle(new Date(start.getTime() + 90 * day))).toEqual({ invoicesIssued: 0, movedToPastDue: 0, suspended: 0 });
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "ACTIVE" });
    });
  });

  describe("administración de plataforma", () => {
    it("cambia de plan, anula el comprobante abierto y emite uno con el nuevo precio", async () => {
      const registered = await registerAt(start);
      await billing.changePlan(operatorId, registered.tenantId, "PREMIUM", start);

      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ planCode: "PREMIUM" });
      const invoices = await invoicesOf(registered.tenantId);
      expect(invoices.map((invoice) => [invoice.status, invoice.amountBob])).toEqual([["VOID", "150.00"], ["OPEN", "700.00"]]);
    });

    it("no permite bajar a un plan cuyos límites ya supera la farmacia", async () => {
      const registered = await registerAt(start, { planCode: "PROFESIONAL" });
      await ownerPool.query(
        "update tenant_resource_usage set used_units = 2 where tenant_id = $1 and resource_code = 'branches'",
        [registered.tenantId]
      );
      await expect(billing.changePlan(operatorId, registered.tenantId, "BASICO", start)).rejects.toMatchObject({ status: 409 });
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ planCode: "PROFESIONAL" });
    });

    it("suspende, reactiva y cancela manualmente respetando la máquina de estados", async () => {
      const registered = await registerAt(start);
      await billing.approvePayment(operatorId, await payInvoice(registered.scope, (await invoicesOf(registered.tenantId))[0]!.id, "150.00"), undefined, start);

      await billing.setStatus(operatorId, registered.tenantId, "SUSPEND", start);
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "SUSPENDED" });
      await billing.setStatus(operatorId, registered.tenantId, "REACTIVATE", start);
      expect(await subscriptionOf(registered.tenantId)).toMatchObject({ status: "ACTIVE" });
      await expect(billing.setStatus(operatorId, registered.tenantId, "REACTIVATE", start)).rejects.toMatchObject({ status: 409 });
      await billing.setStatus(operatorId, registered.tenantId, "CANCEL", start);
      expect(await subscriptionOf(registered.tenantId)).toBeUndefined();
    });

    it("habilita una funcionalidad extra (add-on) solo para una farmacia", async () => {
      const registered = await registerAt(new Date());
      const other = await registerAt(new Date());

      expect(await features.isEnabled(registered.scope, "siat")).toBe(false);
      await billing.setFeatureOverride(operatorId, registered.tenantId, "siat", true);
      expect(await features.isEnabled(registered.scope, "siat")).toBe(true);
      expect(await features.isEnabled(other.scope, "siat")).toBe(false);
      expect((await tenantBilling.summary(registered.scope)).features.find((f) => f.code === "siat")).toMatchObject({ enabled: true, addOn: true });

      await billing.setFeatureOverride(operatorId, registered.tenantId, "siat", null);
      expect(await features.isEnabled(registered.scope, "siat")).toBe(false);
      await expect(billing.setFeatureOverride(operatorId, registered.tenantId, "no-existe", true)).rejects.toMatchObject({ status: 400 });
    });

    it("inicia sesión de operador con un token que no sirve como sesión de farmacia", async () => {
      const session = await platform.login("OPS@farmaxia.bo", "OperadorSeguro123");
      await expect(platform.login("ops@farmaxia.bo", "incorrecta")).rejects.toMatchObject({ status: 401 });

      await expect(platformTokens.verify(session.accessToken)).resolves.toEqual({ operatorId });
      await expect(new AccessTokenService().verify(session.accessToken)).rejects.toMatchObject({ status: 401 });
      const tenantToken = await new AccessTokenService().issue({ userId: operatorId, tenantId: operatorId, branchId: operatorId });
      await expect(platformTokens.verify(tenantToken)).rejects.toMatchObject({ status: 401 });
    });

    it("resume farmacias, ingresos recurrentes y pagos pendientes", async () => {
      const registered = await registerAt(new Date());
      await payInvoice(registered.scope, (await invoicesOf(registered.tenantId))[0]!.id, "150.00");

      const overview = await platform.overview();
      expect(overview).toMatchObject({ tenantsByStatus: { TRIALING: 1 }, pendingPayments: 1, openInvoices: { count: 1, amountBob: "150.00" } });
      const tenants = await platform.listTenants("santa");
      expect(tenants).toHaveLength(1);
      expect(tenants[0]).toMatchObject({ status: "TRIALING", planCode: "BASICO", pendingPayments: 1 });
    });
  });

  describe("bitácora de auditoría", () => {
    it("muestra solo los días que permite el plan", async () => {
      const now = new Date();
      const registered = await registerAt(now);
      for (const daysAgo of [1, 10]) {
        await ownerPool.query(
          `insert into audit_events (tenant_id, branch_id, actor_user_id, action, entity_type, entity_id, occurred_at)
           values ($1, $2, $3, $4, 'test', 'x', $5)`,
          [registered.tenantId, registered.branchId, registered.userId, `test.${daysAgo}d`, new Date(now.getTime() - daysAgo * day)]
        );
      }

      const basic = await auditLog.list(registered.scope, { action: "test." }, now);
      expect(basic.retentionDays).toBe(7);
      expect(basic.items.map((item) => item.action)).toEqual(["test.1d"]);
      expect(basic.items[0]?.actorName).toBe("Ana Rojas");

      await billing.changePlan(operatorId, registered.tenantId, "PREMIUM", now);
      const premium = await auditLog.list(registered.scope, { action: "test." }, now);
      expect(premium.retentionDays).toBeNull();
      expect(premium.items.map((item) => item.action)).toEqual(["test.1d", "test.10d"]);
    });
  });

  describe("HTTP", () => {
    it("registra por la API, abre sesión y bloquea módulos a una farmacia suspendida sin bloquear su pago", async () => {
      process.env.DATABASE_APP_URL = testAppUrl;
      process.env.DATABASE_AUTH_URL = testAuthUrl;
      process.env.DATABASE_PLATFORM_URL = testPlatformUrl;
      const { AppModule } = await import("../src/app.module.js");
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.register(fastifyCookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      try {
        const register = await app.inject({
          method: "POST",
          url: "/api/v1/onboarding/register",
          payload: pharmacy({ email: "http@farmacia.bo" })
        });
        expect(register.statusCode).toBe(201);
        expect(register.headers["set-cookie"]).toBeDefined();
        const { accessToken, tenantId } = register.json() as { accessToken: string; tenantId: string };
        const auth = { authorization: `Bearer ${accessToken}` };

        expect((await app.inject({ method: "GET", url: "/api/v1/catalog/products", headers: auth })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/api/v1/billing/invoices", headers: auth })).statusCode).toBe(200);

        await billing.setStatus(operatorId, tenantId, "SUSPEND");
        const blocked = await app.inject({ method: "GET", url: "/api/v1/catalog/products", headers: auth });
        expect(blocked.statusCode).toBe(402);
        expect(blocked.json()).toMatchObject({ code: "SUBSCRIPTION_INACTIVE" });
        const status = await app.inject({ method: "GET", url: "/api/v1/subscription", headers: auth });
        expect(status.statusCode).toBe(200);
        expect(status.json()).toMatchObject({ status: "SUSPENDED", hasAccess: false });

        expect((await app.inject({ method: "GET", url: "/api/v1/platform/overview", headers: auth })).statusCode).toBe(401);
        const login = await app.inject({
          method: "POST",
          url: "/api/v1/platform/auth/login",
          payload: { email: "ops@farmaxia.bo", password: "OperadorSeguro123" }
        });
        const platformAuth = { authorization: `Bearer ${(login.json() as { accessToken: string }).accessToken}` };
        expect((await app.inject({ method: "GET", url: "/api/v1/platform/overview", headers: platformAuth })).statusCode).toBe(200);
        expect((await app.inject({ method: "GET", url: "/api/v1/catalog/products", headers: platformAuth })).statusCode).toBe(401);
      } finally {
        await app.close();
      }
      // Arranca la aplicación completa: tarda más que una prueba de servicio.
    }, 30_000);
  });
});
