import fastifyCookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccessTokenService } from "../src/auth/access-token.service.js";
import { AuthDatabase } from "../src/auth/auth-database.js";
import { AuthService } from "../src/auth/auth.service.js";
import type { AuthContext, LoginOutcome, SessionTokens } from "../src/auth/auth.types.js";
import { PasswordHasher } from "../src/auth/password-hasher.js";
import { currentTotpStep, totpCode } from "../src/auth/totp.js";
import { IdentityDatabase } from "../src/identity/identity-database.js";
import { IdentityService } from "../src/identity/identity.service.js";
import { BillingService } from "../src/saas/billing.service.js";
import { OnboardingService } from "../src/saas/onboarding.service.js";
import { PlatformDatabase } from "../src/saas/platform-database.js";

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
const testAuthUrl = process.env.DATABASE_AUTH_TEST_URL ?? role("farmaxia_auth");
const testAppUrl = process.env.DATABASE_APP_TEST_URL ?? role("farmaxia_app");
const testPlatformUrl = process.env.DATABASE_PLATFORM_TEST_URL ?? role("farmaxia_platform");
const testIdentityUrl = process.env.DATABASE_IDENTITY_TEST_URL ?? role("farmaxia_identity");

process.env.AUTH_JWT_SECRET ??= "test-only-secret-with-at-least-thirty-two-characters";
process.env.DATABASE_AUTH_URL = testAuthUrl;

const ownerPool = new Pool({ connectionString: testOwnerUrl });
const platformDatabase = new PlatformDatabase(testPlatformUrl);
const identityDatabase = new IdentityDatabase(testIdentityUrl);
const authDatabase = new AuthDatabase();
const hasher = new PasswordHasher();
const onboarding = new OnboardingService(platformDatabase, hasher, new BillingService(platformDatabase));
const auth = new AuthService(authDatabase, hasher, new AccessTokenService());
const identity = new IdentityService(identityDatabase, hasher);

const password = "ClaveSegura123";

interface Pharmacy {
  tenantId: string;
  branchId: string;
  userId: string;
  slug: string;
  email: string;
  scope: AuthContext;
}

async function registerPharmacy(name: string, planCode = "BASICO"): Promise<Pharmacy> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@farmacia.bo`;
  const registered = await onboarding.register({
    pharmacyName: name,
    legalName: `${name} S.R.L.`,
    taxId: "1234567019",
    ownerName: `Dueña ${name}`,
    email,
    password,
    planCode
  });
  return {
    tenantId: registered.tenantId,
    branchId: registered.branchId,
    userId: registered.userId,
    slug: registered.tenantSlug,
    email,
    scope: { tenantId: registered.tenantId, branchId: registered.branchId, userId: registered.userId }
  };
}

async function roleId(pharmacy: Pharmacy, code: string): Promise<string> {
  const roles = await identity.listRoles(pharmacy.scope);
  const found = roles.find((role) => role.code === code);
  if (!found) throw new Error(`role ${code} not found`);
  return found.id;
}

async function addUser(pharmacy: Pharmacy, roleCodes: string[], email: string): Promise<AuthContext> {
  const roleIds = await Promise.all(roleCodes.map((code) => roleId(pharmacy, code)));
  const { id } = await identity.createUser(pharmacy.scope, {
    displayName: `Usuario ${email}`,
    email,
    password,
    roleIds,
    branchIds: [pharmacy.branchId]
  });
  return { tenantId: pharmacy.tenantId, branchId: pharmacy.branchId, userId: id };
}

function session(outcome: LoginOutcome): SessionTokens {
  if (outcome.kind !== "session") throw new Error(`expected a session, got ${outcome.kind}`);
  return outcome.tokens;
}

describe("Usuarios, roles y seguridad", () => {
  beforeEach(async () => {
    await ownerPool.query(`
      truncate table
        saas_payments, saas_invoices, subscription_feature_overrides, platform_audit_events,
        audit_events, idempotency_records, outbox_events, document_sequences,
        subscription_quota_overrides, tenant_resource_usage, tenant_subscriptions,
        background_jobs, tenant_files, auth_sessions, user_roles, role_permissions, roles,
        user_branch_memberships, cash_shift_controls, cash_shift_users, cash_shifts, cash_registers,
        warehouses, branches, legal_entities, users, tenants
      cascade
    `);
  });

  afterAll(async () => {
    await Promise.all([ownerPool.end(), platformDatabase.close(), identityDatabase.close(), authDatabase.close()]);
  });

  describe("inicio de sesión", () => {
    it("entra solo con correo y contraseña cuando hay una farmacia y una sucursal", async () => {
      const pharmacy = await registerPharmacy("Farmacia Sol");
      const tokens = session(await auth.login({ email: pharmacy.email, password }));
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(session(await auth.login({ email: pharmacy.email, password, tenant: pharmacy.slug })).accessToken).toEqual(expect.any(String));
      await expect(auth.login({ email: pharmacy.email, password, tenant: "otra-farmacia" })).rejects.toMatchObject({ status: 401 });
      await expect(auth.login({ email: pharmacy.email, password: "incorrecta123" })).rejects.toMatchObject({ status: 401 });
    });

    it("pide elegir sucursal solo después de validar la contraseña", async () => {
      const pharmacy = await registerPharmacy("Farmacia Luna", "PREMIUM");
      const { rows } = await ownerPool.query<{ id: string }>(
        `insert into branches (tenant_id, legal_entity_id, code, name)
         select tenant_id, id, 'SUC-002', 'Sucursal Norte' from legal_entities where tenant_id = $1 returning id`,
        [pharmacy.tenantId]
      );
      const secondBranch = rows[0]!.id;
      await ownerPool.query(
        "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)",
        [pharmacy.userId, pharmacy.tenantId, secondBranch]
      );

      await expect(auth.login({ email: pharmacy.email, password: "mala-clave-99" })).rejects.toMatchObject({ status: 401 });
      const outcome = await auth.login({ email: pharmacy.email, password });
      expect(outcome.kind).toBe("select_branch");
      expect(outcome.kind === "select_branch" && outcome.options.map((option) => option.branchName)).toEqual(["Casa Matriz", "Sucursal Norte"]);

      session(await auth.login({ email: pharmacy.email, password, branchId: secondBranch }));
      const account = await auth.account({ ...pharmacy.scope, branchId: secondBranch });
      expect(account).toMatchObject({ branchName: "Sucursal Norte", tenantSlug: "farmacia-luna", twoFactorEnabled: false });
      expect(account.branches).toHaveLength(2);
    });
  });

  describe("roles", () => {
    it("crea los 5 roles predefinidos con sus permisos y no permite modificarlos", async () => {
      const pharmacy = await registerPharmacy("Farmacia Roles");
      const roles = await identity.listRoles(pharmacy.scope);
      expect(roles.map((role) => role.code).sort()).toEqual(["almacenero", "cajero", "encargado", "owner", "regente"]);
      expect(roles.find((role) => role.code === "cajero")?.permissions).toEqual(["cash.manage", "customers.manage", "fiscal.read", "sales.confirm", "sales.read"]);
      expect(await identity.listPermissions(pharmacy.scope)).toHaveLength(26);

      const cashier = await roleId(pharmacy, "cajero");
      await expect(identity.updateRole(pharmacy.scope, cashier, { name: "Otro" })).rejects.toMatchObject({ status: 409 });
      await expect(identity.deleteRole(pharmacy.scope, cashier)).rejects.toMatchObject({ status: 409 });
    });

    it("crea, edita y elimina roles personalizados", async () => {
      const pharmacy = await registerPharmacy("Farmacia Custom", "PREMIUM");
      const { id } = await identity.createRole(pharmacy.scope, { name: "Visitador", permissionCodes: ["catalog.manage"] });
      await identity.updateRole(pharmacy.scope, id, { name: "Visitador médico", permissionCodes: ["catalog.manage", "audit.read"] });
      expect((await identity.listRoles(pharmacy.scope)).find((role) => role.id === id)).toMatchObject({
        name: "Visitador médico",
        isSystem: false,
        permissions: ["audit.read", "catalog.manage"]
      });

      const user = await identity.createUser(pharmacy.scope, {
        displayName: "Visitador", email: "visitador@farmacia.bo", password, roleIds: [id], branchIds: [pharmacy.branchId]
      });
      await expect(identity.deleteRole(pharmacy.scope, id)).rejects.toMatchObject({ status: 409 });
      await identity.updateUser(pharmacy.scope, user.id, { roleIds: [await roleId(pharmacy, "cajero")] });
      await identity.deleteRole(pharmacy.scope, id);
      expect((await identity.listRoles(pharmacy.scope)).some((role) => role.id === id)).toBe(false);
    });
  });

  describe("usuarios", () => {
    it("crea un cajero que entra con sus permisos y respeta el límite del plan", async () => {
      const pharmacy = await registerPharmacy("Farmacia Caja");
      const cashier = await addUser(pharmacy, ["cajero"], "cajero@farmacia.bo");

      expect(await auth.permissionsFor(cashier)).toEqual(["cash.manage", "customers.manage", "fiscal.read", "sales.confirm", "sales.read"]);
      session(await auth.login({ email: "cajero@farmacia.bo", password }));

      // Básico permite 2 usuarios: dueña + cajero.
      await expect(addUser(pharmacy, ["cajero"], "otro@farmacia.bo")).rejects.toMatchObject({ status: 409, response: { code: "PLAN_QUOTA_EXCEEDED" } });
      await identity.updateUser(pharmacy.scope, cashier.userId, { isActive: false });
      await addUser(pharmacy, ["cajero"], "otro@farmacia.bo");
      await expect(identity.updateUser(pharmacy.scope, cashier.userId, { isActive: true })).rejects.toMatchObject({ status: 409 });
    });

    it("desactivar a alguien cierra sus sesiones y le quita los permisos al instante", async () => {
      const pharmacy = await registerPharmacy("Farmacia Baja");
      const cashier = await addUser(pharmacy, ["cajero"], "baja@farmacia.bo");
      const tokens = session(await auth.login({ email: "baja@farmacia.bo", password }));

      await identity.updateUser(pharmacy.scope, cashier.userId, { isActive: false });

      expect(await auth.permissionsFor(cashier)).toEqual([]);
      await expect(auth.refresh(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
      await expect(auth.login({ email: "baja@farmacia.bo", password })).rejects.toMatchObject({ status: 401 });
    });

    it("rechaza correo repetido, contraseña débil, sin rol o sin sucursal", async () => {
      const pharmacy = await registerPharmacy("Farmacia Datos", "PREMIUM");
      const cashier = await roleId(pharmacy, "cajero");
      const base = { displayName: "Ana", email: "ana@farmacia.bo", password, roleIds: [cashier], branchIds: [pharmacy.branchId] };
      await identity.createUser(pharmacy.scope, base);
      await expect(identity.createUser(pharmacy.scope, base)).rejects.toMatchObject({ status: 409 });
      await expect(identity.createUser(pharmacy.scope, { ...base, email: "b@farmacia.bo", password: "corta" })).rejects.toMatchObject({ status: 400 });
      await expect(identity.createUser(pharmacy.scope, { ...base, email: "c@farmacia.bo", roleIds: [] })).rejects.toMatchObject({ status: 400 });
      await expect(identity.createUser(pharmacy.scope, { ...base, email: "d@farmacia.bo", branchIds: [] })).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("protecciones", () => {
    it("nadie otorga permisos que no tiene ni administra a alguien con más permisos", async () => {
      const pharmacy = await registerPharmacy("Farmacia Escalada", "PREMIUM");
      const { id: supervisorRole } = await identity.createRole(pharmacy.scope, {
        name: "Supervisor", permissionCodes: ["users.manage", "sales.confirm", "sales.read", "fiscal.read", "cash.manage", "customers.manage"]
      });
      const { id: supervisorId } = await identity.createUser(pharmacy.scope, {
        displayName: "Supervisor", email: "super@farmacia.bo", password, roleIds: [supervisorRole], branchIds: [pharmacy.branchId]
      });
      const supervisor: AuthContext = { ...pharmacy.scope, userId: supervisorId };

      await expect(identity.createRole(supervisor, { name: "Todo", permissionCodes: ["catalog.manage"] })).rejects.toMatchObject({ status: 403 });
      await expect(identity.createUser(supervisor, {
        displayName: "Nuevo dueño", email: "x@farmacia.bo", password, roleIds: [await roleId(pharmacy, "owner")], branchIds: [pharmacy.branchId]
      })).rejects.toMatchObject({ status: 403 });
      await expect(identity.resetPassword(supervisor, pharmacy.userId, "OtraClave12345")).rejects.toMatchObject({ status: 403 });
      // Sí puede crear un cajero: sus permisos están dentro de los suyos.
      await identity.createUser(supervisor, {
        displayName: "Cajero", email: "cajero2@farmacia.bo", password, roleIds: [await roleId(pharmacy, "cajero")], branchIds: [pharmacy.branchId]
      });
    });

    it("siempre queda un Propietario activo y nadie se desactiva a sí mismo", async () => {
      const pharmacy = await registerPharmacy("Farmacia Dueño", "PREMIUM");
      await expect(identity.updateUser(pharmacy.scope, pharmacy.userId, { isActive: false })).rejects.toMatchObject({ status: 409 });

      const allPermissions = (await identity.listPermissions(pharmacy.scope)).map((permission) => permission.code);
      const { id: adminRole } = await identity.createRole(pharmacy.scope, { name: "Administrador", permissionCodes: allPermissions });
      const admin = await identity.createUser(pharmacy.scope, {
        displayName: "Admin", email: "admin@farmacia.bo", password, roleIds: [adminRole], branchIds: [pharmacy.branchId]
      });
      const adminScope: AuthContext = { ...pharmacy.scope, userId: admin.id };

      await expect(identity.updateUser(adminScope, pharmacy.userId, { roleIds: [await roleId(pharmacy, "cajero")] }))
        .rejects.toMatchObject({ status: 409, response: { code: "LAST_OWNER" } });
      await expect(identity.updateUser(adminScope, pharmacy.userId, { isActive: false }))
        .rejects.toMatchObject({ status: 409, response: { code: "LAST_OWNER" } });
    });

    it("aísla usuarios y roles entre farmacias", async () => {
      const a = await registerPharmacy("Farmacia Alfa");
      const b = await registerPharmacy("Farmacia Beta");
      const cashierA = await addUser(a, ["cajero"], "cajero.alfa@farmacia.bo");

      expect((await identity.listUsers(b.scope)).map((user) => user.email)).toEqual(["farmacia.beta@farmacia.bo"]);
      await expect(identity.updateUser(b.scope, cashierA.userId, { roleIds: [await roleId(b, "cajero")] })).rejects.toMatchObject({ status: 404 });
      await expect(identity.resetPassword(b.scope, cashierA.userId, "OtraClave12345")).rejects.toMatchObject({ status: 404 });
      await expect(identity.createUser(b.scope, {
        displayName: "X", email: "x@beta.bo", password, roleIds: [await roleId(a, "cajero")], branchIds: [b.branchId]
      })).rejects.toMatchObject({ status: 400 });
      await expect(identity.updateRole(b.scope, await roleId(a, "owner"), { name: "Hack" })).rejects.toMatchObject({ status: 404 });
    });

    it("una cuenta que también trabaja en otra farmacia solo se administra en la suya", async () => {
      const a = await registerPharmacy("Farmacia Casa", "PREMIUM");
      const b = await registerPharmacy("Farmacia Visita", "PREMIUM");
      const shared = await addUser(a, ["cajero"], "compartido@farmacia.bo");
      await ownerPool.query("insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3)", [shared.userId, b.tenantId, b.branchId]);
      await ownerPool.query("insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3)", [shared.userId, b.tenantId, await roleId(b, "cajero")]);

      const seenByB = (await identity.listUsers(b.scope)).find((user) => user.id === shared.userId);
      expect(seenByB).toMatchObject({ managedHere: false, roles: [{ code: "cajero" }] });
      await expect(identity.resetPassword(b.scope, shared.userId, "OtraClave12345")).rejects.toMatchObject({ status: 403 });
      await expect(identity.updateUser(b.scope, shared.userId, { isActive: false })).rejects.toMatchObject({ status: 403 });
      await identity.updateUser(b.scope, shared.userId, { roleIds: [await roleId(b, "almacenero")] });

      // Con dos farmacias, el login pide elegir.
      const outcome = await auth.login({ email: "compartido@farmacia.bo", password });
      expect(outcome.kind === "select_branch" && outcome.options.map((option) => option.tenantName).sort()).toEqual(["Farmacia Casa", "Farmacia Visita"]);
    });
  });

  describe("mi cuenta", () => {
    it("activa la verificación en dos pasos y la exige al iniciar sesión", async () => {
      const pharmacy = await registerPharmacy("Farmacia Segura");
      const { secret, otpauthUri } = await auth.setupTwoFactor(pharmacy.scope);
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/FARMAXIA/);
      await expect(auth.enableTwoFactor(pharmacy.scope, "000000")).rejects.toMatchObject({ status: 400 });
      await auth.enableTwoFactor(pharmacy.scope, totpCode(secret, currentTotpStep()));

      const outcome = await auth.login({ email: pharmacy.email, password });
      expect(outcome.kind).toBe("totp");
      const challenge = outcome.kind === "totp" ? outcome.challengeToken : "";
      await expect(auth.completeTotpLogin(challenge, "123456")).rejects.toMatchObject({ status: 401 });
      const nextCode = totpCode(secret, currentTotpStep() + 1);
      expect((await auth.completeTotpLogin(challenge, nextCode)).accessToken).toEqual(expect.any(String));
      // El mismo código no sirve dos veces.
      await expect(auth.completeTotpLogin(challenge, nextCode)).rejects.toMatchObject({ status: 401 });
      // El desafío no es una sesión.
      await expect(new AccessTokenService().verify(challenge)).rejects.toMatchObject({ status: 401 });

      await expect(auth.disableTwoFactor(pharmacy.scope, "incorrecta1")).rejects.toMatchObject({ status: 400 });
      await auth.disableTwoFactor(pharmacy.scope, password);
      expect((await auth.login({ email: pharmacy.email, password })).kind).toBe("session");
    });

    it("el administrador puede quitar el 2FA a quien perdió su teléfono", async () => {
      const pharmacy = await registerPharmacy("Farmacia Telefono", "PREMIUM");
      const cashier = await addUser(pharmacy, ["cajero"], "sin.telefono@farmacia.bo");
      const { secret } = await auth.setupTwoFactor(cashier);
      await auth.enableTwoFactor(cashier, totpCode(secret, currentTotpStep()));
      expect((await auth.login({ email: "sin.telefono@farmacia.bo", password })).kind).toBe("totp");

      await identity.resetTwoFactor(pharmacy.scope, cashier.userId);
      expect((await auth.login({ email: "sin.telefono@farmacia.bo", password })).kind).toBe("session");
    });

    it("cambiar la contraseña cierra las demás sesiones", async () => {
      const pharmacy = await registerPharmacy("Farmacia Clave");
      const current = session(await auth.login({ email: pharmacy.email, password }));
      const other = session(await auth.login({ email: pharmacy.email, password }));

      await expect(auth.changePassword(pharmacy.scope, "incorrecta1", "NuevaClave12345", current.refreshToken)).rejects.toMatchObject({ status: 400 });
      await auth.changePassword(pharmacy.scope, password, "NuevaClave12345", current.refreshToken);

      await expect(auth.refresh(other.refreshToken)).rejects.toMatchObject({ status: 401 });
      await expect(auth.refresh(current.refreshToken)).resolves.toMatchObject({ accessToken: expect.any(String) });
      await expect(auth.login({ email: pharmacy.email, password })).rejects.toMatchObject({ status: 401 });
      session(await auth.login({ email: pharmacy.email, password: "NuevaClave12345" }));
    });

    it("lista las sesiones activas y permite cerrarlas", async () => {
      const pharmacy = await registerPharmacy("Farmacia Sesiones");
      const laptop = session(await auth.login({ email: pharmacy.email, password }, { userAgent: "Laptop", ipAddress: "10.0.0.1" }));
      const phone = session(await auth.login({ email: pharmacy.email, password }, { userAgent: "Telefono", ipAddress: "10.0.0.2" }));
      session(await auth.login({ email: pharmacy.email, password }, { userAgent: "Tablet" }));

      const sessions = await auth.listSessions(pharmacy.scope, laptop.refreshToken);
      expect(sessions).toHaveLength(3);
      expect(sessions.find((item) => item.current)).toMatchObject({ userAgent: "Laptop", branchName: "Casa Matriz" });

      const phoneSession = sessions.find((item) => item.userAgent === "Telefono");
      await auth.revokeSession(pharmacy.scope, phoneSession!.id);
      await expect(auth.refresh(phone.refreshToken)).rejects.toMatchObject({ status: 401 });

      expect(await auth.revokeOtherSessions(pharmacy.scope, laptop.refreshToken)).toBe(1);
      expect(await auth.listSessions(pharmacy.scope, laptop.refreshToken)).toHaveLength(1);
    });
  });

  describe("HTTP", () => {
    it("expone el login por pasos y protege la administración con users.manage", async () => {
      process.env.DATABASE_APP_URL = testAppUrl;
      process.env.DATABASE_PLATFORM_URL = testPlatformUrl;
      process.env.DATABASE_IDENTITY_URL = testIdentityUrl;
      const pharmacy = await registerPharmacy("Farmacia Http", "PREMIUM");
      await addUser(pharmacy, ["cajero"], "cajero.http@farmacia.bo");

      const { AppModule } = await import("../src/app.module.js");
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.register(fastifyCookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      try {
        const login = async (email: string) => {
          const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
          expect(response.statusCode).toBe(201);
          return { authorization: `Bearer ${(response.json() as { accessToken: string }).accessToken}` };
        };
        const owner = await login(pharmacy.email);
        const cashier = await login("cajero.http@farmacia.bo");

        const users = await app.inject({ method: "GET", url: "/api/v1/users", headers: owner });
        expect(users.statusCode).toBe(200);
        expect((users.json() as unknown[]).length).toBe(2);
        expect((await app.inject({ method: "GET", url: "/api/v1/users", headers: cashier })).statusCode).toBe(403);
        expect((await app.inject({ method: "GET", url: "/api/v1/auth/account", headers: cashier })).json()).toMatchObject({ tenantName: "Farmacia Http" });
      } finally {
        await app.close();
      }
      // Arranca la aplicación completa: tarda más que una prueba de servicio.
    }, 30_000);
  });
});
