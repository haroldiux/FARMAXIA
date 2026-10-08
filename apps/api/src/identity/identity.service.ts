import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { PasswordHasher } from "../auth/password-hasher.js";
import { assertStrongPassword } from "../auth/password-policy.js";
import type { TenantScope } from "../database/tenant-database.js";
import { consumeQuota, QuotaExceededError, releaseQuota, SubscriptionAccessError } from "../subscriptions/quota.service.js";
import { IdentityDatabase } from "./identity-database.js";
import { ownerRoleCode } from "./role-templates.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TenantUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  twoFactorEnabled: boolean;
  /** La cuenta se creó en esta farmacia: aquí se puede cambiar nombre, estado y contraseña. */
  managedHere: boolean;
  roles: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
}

export interface TenantRole {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  users: number;
}

export interface CreateUserInput {
  displayName: string;
  email: string;
  password: string;
  roleIds: string[];
  branchIds: string[];
}

export interface UpdateUserInput {
  displayName?: string;
  isActive?: boolean;
  roleIds?: string[];
  branchIds?: string[];
}

export interface RoleInput {
  name?: string;
  description?: string;
  permissionCodes?: string[];
}

export interface CreateBranchInput {
  code: string;
  name: string;
  legalEntityId?: string;
}

export interface UpdateBranchInput {
  code?: string;
  name?: string;
  isActive?: boolean;
}

export interface TenantBranchSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt?: Date;
  initialRegisterCreated?: boolean;
}

/**
 * Administración de usuarios y roles de una farmacia. Reglas de seguridad:
 * - nadie asigna permisos que no tiene (sin escalada);
 * - siempre queda al menos un Propietario activo;
 * - nadie se desactiva ni cambia sus propios roles;
 * - contraseña, nombre y estado solo se cambian en la farmacia dueña de la cuenta.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(IdentityDatabase) private readonly database: IdentityDatabase,
    @Inject(PasswordHasher) private readonly passwordHasher: PasswordHasher
  ) {}

  async listUsers(scope: TenantScope): Promise<TenantUser[]> {
    return this.database.withScope(scope, (client) => this.queryUsers(client, scope.tenantId));
  }

  async listBranches(scope: TenantScope): Promise<TenantBranchSummary[]> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<TenantBranchSummary>(
        `select id, code, name, is_active as "isActive", created_at as "createdAt" from branches where tenant_id = $1 order by code`,
        [scope.tenantId]
      );
      return rows;
    });
  }

  async createBranch(scope: TenantScope, raw: CreateBranchInput): Promise<TenantBranchSummary> {
    const code = raw?.code ? text(raw.code, "code", 1, 32).toUpperCase() : "";
    if (!code || !/^[A-Z0-9_\-\.]+$/.test(code)) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "code", message: "El código de la sucursal debe tener entre 1 y 32 caracteres alfanuméricos." });
    }
    const name = text(raw?.name, "name", 1, 160);

    return this.database.withScope(scope, async (client) => {
      try {
        await consumeQuota(client, scope.tenantId, "branches", 1);
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          throw new HttpException(
            { statusCode: 409, code: "PLAN_QUOTA_EXCEEDED", message: "Tu plan no permite registrar más sucursales activas. Sube de plan o desactiva alguna existente." },
            HttpStatus.CONFLICT
          );
        }
        if (error instanceof SubscriptionAccessError) {
          throw new HttpException(
            { statusCode: 402, code: "SUBSCRIPTION_INACTIVE", message: "La suscripción de la farmacia no está activa." },
            HttpStatus.PAYMENT_REQUIRED
          );
        }
        throw error;
      }

      const existing = await client.query<{ id: string }>(
        `select id from branches where tenant_id = $1 and code = $2`,
        [scope.tenantId, code]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException({
          code: "BRANCH_CODE_EXISTS",
          message: `Ya existe una sucursal con el código ${code}.`
        });
      }

      let legalEntityId = raw.legalEntityId;
      if (!legalEntityId) {
        const le = await client.query<{ id: string }>(
          `select id from legal_entities where tenant_id = $1 order by created_at asc limit 1`,
          [scope.tenantId]
        );
        if (!le.rowCount || le.rowCount === 0) {
          throw new BadRequestException("La farmacia no tiene una razón social configurada.");
        }
        legalEntityId = le.rows[0]!.id;
      } else {
        assertUuid(legalEntityId);
        const le = await client.query<{ id: string }>(
          `select id from legal_entities where tenant_id = $1 and id = $2`,
          [scope.tenantId, legalEntityId]
        );
        if (!le.rowCount || le.rowCount === 0) {
          throw new BadRequestException("La entidad legal especificada no existe.");
        }
      }

      const result = await client.query<TenantBranchSummary>(
        `insert into branches (tenant_id, legal_entity_id, code, name, is_active)
         values ($1, $2, $3, $4, true)
         returning id, code, name, is_active as "isActive", created_at as "createdAt"`,
        [scope.tenantId, legalEntityId, code, name]
      );
      const created = result.rows[0]!;

      // Automatically initialize default general warehouse
      await client.query(
        `insert into warehouses (tenant_id, branch_id, name, is_dispatch_enabled, warehouse_type)
         values ($1, $2, 'Almacén Central', true, 'CENTRAL')`,
        [scope.tenantId, created.id]
      );

      // Add caller to branch membership
      if (scope.userId) {
        await client.query(
          `insert into user_branch_memberships (user_id, tenant_id, branch_id)
           values ($1, $2, $3)
           on conflict do nothing`,
          [scope.userId, scope.tenantId, created.id]
        );
      }

      // Try to create initial cash register if cash_registers quota permits
      let initialRegisterCreated = false;
      try {
        await consumeQuota(client, scope.tenantId, "cash_registers", 1);
        await client.query(
          `insert into cash_registers (tenant_id, branch_id, code, is_active)
           values ($1, $2, 'CAJA-01', true)`,
          [scope.tenantId, created.id]
        );
        initialRegisterCreated = true;
      } catch (regError) {
        if (!(regError instanceof QuotaExceededError)) {
          throw regError;
        }
      }

      await audit(client, scope, "branch.created", created.id, {
        code: created.code,
        name: created.name,
        initialRegisterCreated
      });

      return { ...created, initialRegisterCreated };
    });
  }

  async updateBranch(scope: TenantScope, branchId: string, raw: UpdateBranchInput): Promise<TenantBranchSummary> {
    assertUuid(branchId);
    return this.database.withScope(scope, async (client) => {
      const currentResult = await client.query<TenantBranchSummary>(
        `select id, code, name, is_active as "isActive", created_at as "createdAt"
         from branches
         where tenant_id = $1 and id = $2`,
        [scope.tenantId, branchId]
      );
      if (currentResult.rowCount === 0) {
        throw new NotFoundException("Sucursal no encontrada.");
      }
      const current = currentResult.rows[0]!;

      let newCode = current.code;
      if (raw.code !== undefined) {
        const trimmedCode = text(raw.code, "code", 1, 32).toUpperCase();
        if (!/^[A-Z0-9_\-\.]+$/.test(trimmedCode)) {
          throw new BadRequestException({ code: "INVALID_INPUT", field: "code", message: "El código de la sucursal debe tener entre 1 y 32 caracteres alfanuméricos." });
        }
        if (trimmedCode !== current.code) {
          const existing = await client.query<{ id: string }>(
            `select id from branches where tenant_id = $1 and code = $2 and id <> $3`,
            [scope.tenantId, trimmedCode, branchId]
          );
          if (existing.rowCount && existing.rowCount > 0) {
            throw new ConflictException({
              code: "BRANCH_CODE_EXISTS",
              message: `Ya existe una sucursal con el código ${trimmedCode}.`
            });
          }
          newCode = trimmedCode;
        }
      }

      let newName = current.name;
      if (raw.name !== undefined) {
        newName = text(raw.name, "name", 1, 160);
      }

      let newActive = current.isActive;
      if (raw.isActive !== undefined && raw.isActive !== current.isActive) {
        if (!raw.isActive) {
          const activeBranches = await client.query<{ count: string }>(
            `select count(*)::int as count from branches where tenant_id = $1 and is_active = true and id <> $2`,
            [scope.tenantId, branchId]
          );
          if (Number(activeBranches.rows[0]?.count ?? 0) === 0) {
            throw new ConflictException({
              code: "CANNOT_DEACTIVATE_LAST_BRANCH",
              message: "No puedes desactivar la única sucursal activa de la farmacia."
            });
          }

          const openShifts = await client.query<{ id: string }>(
            `select csc.id
             from cash_shift_controls csc
             join cash_shifts cs on cs.id = csc.cash_shift_id
             where cs.tenant_id = $1 and cs.branch_id = $2
               and csc.status in ('OPEN', 'PENDING_APPROVAL')
             limit 1`,
            [scope.tenantId, branchId]
          );
          if (openShifts.rowCount && openShifts.rowCount > 0) {
            throw new ConflictException({
              code: "BRANCH_IN_USE",
              message: "No puedes desactivar una sucursal con turnos de caja abiertos o pendientes de aprobación."
            });
          }

          await releaseQuota(client, scope.tenantId, "branches", 1);

          const activeRegs = await client.query<{ count: string }>(
            `select count(*)::int as count from cash_registers where tenant_id = $1 and branch_id = $2 and is_active = true`,
            [scope.tenantId, branchId]
          );
          const count = Number(activeRegs.rows[0]?.count ?? 0);
          if (count > 0) {
            await releaseQuota(client, scope.tenantId, "cash_registers", count);
            await client.query(
              `update cash_registers set is_active = false where tenant_id = $1 and branch_id = $2 and is_active = true`,
              [scope.tenantId, branchId]
            );
          }
          newActive = false;
        } else {
          try {
            await consumeQuota(client, scope.tenantId, "branches", 1);
          } catch (error) {
            if (error instanceof QuotaExceededError) {
              throw new HttpException(
                { statusCode: 409, code: "PLAN_QUOTA_EXCEEDED", message: "Tu plan no permite más sucursales activas. Sube de plan o desactiva alguna existente." },
                HttpStatus.CONFLICT
              );
            }
            if (error instanceof SubscriptionAccessError) {
              throw new HttpException(
                { statusCode: 402, code: "SUBSCRIPTION_INACTIVE", message: "La suscripción de la farmacia no está activa." },
                HttpStatus.PAYMENT_REQUIRED
              );
            }
            throw error;
          }
          newActive = true;
        }
      }

      const updatedResult = await client.query<TenantBranchSummary>(
        `update branches
         set code = $3, name = $4, is_active = $5
         where tenant_id = $1 and id = $2
         returning id, code, name, is_active as "isActive", created_at as "createdAt"`,
        [scope.tenantId, branchId, newCode, newName, newActive]
      );
      const updated = updatedResult.rows[0]!;

      await audit(client, scope, "branch.updated", branchId, {
        previous: { code: current.code, name: current.name, isActive: current.isActive },
        next: { code: updated.code, name: updated.name, isActive: updated.isActive }
      });

      return updated;
    });
  }

  async listPermissions(scope: TenantScope): Promise<Array<{ code: string; label: string; module: string }>> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<{ code: string; label: string; module: string }>(
        `select code, coalesce(nullif(label, ''), code) as label, module from permissions order by sort_order, code`
      );
      return rows;
    });
  }

  async listRoles(scope: TenantScope): Promise<TenantRole[]> {
    return this.database.withScope(scope, (client) => this.queryRoles(client, scope.tenantId));
  }

  async createUser(scope: TenantScope, raw: CreateUserInput): Promise<{ id: string }> {
    const input = {
      displayName: text(raw?.displayName, "displayName", 2, 160),
      email: email(raw?.email),
      password: assertStrongPassword(raw?.password),
      roleIds: idList(raw?.roleIds, "roleIds"),
      branchIds: idList(raw?.branchIds, "branchIds")
    };
    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.guarded(() => this.database.withScope(scope, async (client) => {
      await this.assertRolesAssignable(client, scope, input.roleIds);
      await this.assertBranchesExist(client, scope.tenantId, input.branchIds);
      await consumeQuota(client, scope.tenantId, "users", 1);

      const { rows } = await client.query<{ id: string }>(
        `insert into users (email, display_name, password_hash, home_tenant_id, password_changed_at)
         values ($1, $2, $3, $4, now()) returning id`,
        [input.email, input.displayName, passwordHash, scope.tenantId]
      );
      const userId = rows[0]?.id as string;
      await this.replaceAccess(client, scope.tenantId, userId, input.roleIds, input.branchIds);
      await audit(client, scope, "user.created", userId, { email: input.email, roleIds: input.roleIds, branchIds: input.branchIds });
      return { id: userId };
    }));
  }

  async updateUser(scope: TenantScope, userId: string, raw: UpdateUserInput): Promise<void> {
    assertUuid(userId);
    const displayName = raw?.displayName === undefined ? undefined : text(raw.displayName, "displayName", 2, 160);
    const isActive = raw?.isActive === undefined ? undefined : bool(raw.isActive, "isActive");
    const roleIds = raw?.roleIds === undefined ? undefined : idList(raw.roleIds, "roleIds");
    const branchIds = raw?.branchIds === undefined ? undefined : idList(raw.branchIds, "branchIds");

    await this.guarded(() => this.database.withScope(scope, async (client) => {
      const target = await this.lockTarget(client, scope, userId);
      if (userId === scope.userId && (isActive === false || roleIds !== undefined)) {
        throw new ConflictException({ code: "CANNOT_EDIT_SELF", message: "No puedes desactivarte ni cambiar tus propios roles." });
      }
      if ((displayName !== undefined || isActive !== undefined) && !target.managedHere) {
        throw new ForbiddenException({
          code: "USER_MANAGED_ELSEWHERE",
          message: "Esta cuenta pertenece a otra farmacia: aquí solo puedes cambiar sus roles y sucursales."
        });
      }
      if (roleIds) {
        await this.assertRolesAssignable(client, scope, roleIds);
      }
      if (branchIds) {
        await this.assertBranchesExist(client, scope.tenantId, branchIds);
      }

      if (displayName !== undefined) {
        await client.query("update users set display_name = $2 where id = $1", [userId, displayName]);
      }
      if (isActive !== undefined && isActive !== target.isActive) {
        await client.query("update users set is_active = $2 where id = $1", [userId, isActive]);
        if (isActive) {
          await consumeQuota(client, scope.tenantId, "users", 1);
        } else {
          await releaseQuota(client, scope.tenantId, "users", 1);
          await revokeSessions(client, scope.tenantId, userId);
        }
      }
      if (roleIds || branchIds) {
        const previousBranches = target.branches.map((branch) => branch.id);
        await this.replaceAccess(client, scope.tenantId, userId, roleIds, branchIds);
        const removed = branchIds ? previousBranches.filter((branch) => !branchIds.includes(branch)) : [];
        if (removed.length) {
          await client.query(
            "update auth_sessions set revoked_at = now() where user_id = $1 and tenant_id = $2 and branch_id = any($3::uuid[]) and revoked_at is null",
            [userId, scope.tenantId, removed]
          );
        }
      }
      await this.assertActiveOwnerRemains(client, scope.tenantId);
      await audit(client, scope, "user.updated", userId, { displayName, isActive, roleIds, branchIds });
    }));
  }

  async resetPassword(scope: TenantScope, userId: string, newPassword: unknown): Promise<void> {
    assertUuid(userId);
    const password = assertStrongPassword(newPassword, "newPassword");
    const hash = await this.passwordHasher.hash(password);
    await this.database.withScope(scope, async (client) => {
      const target = await this.lockTarget(client, scope, userId);
      if (userId === scope.userId) {
        throw new ConflictException({ code: "CANNOT_EDIT_SELF", message: "Cambia tu contraseña desde Mi cuenta." });
      }
      if (!target.managedHere) {
        throw new ForbiddenException({ code: "USER_MANAGED_ELSEWHERE", message: "Esta cuenta pertenece a otra farmacia." });
      }
      await client.query("update users set password_hash = $2, password_changed_at = now() where id = $1", [userId, hash]);
      await revokeSessions(client, scope.tenantId, userId);
      await audit(client, scope, "user.password_reset", userId, {});
    });
  }

  /** Para quien perdió el teléfono: desactiva su 2FA y podrá configurarlo de nuevo. */
  async resetTwoFactor(scope: TenantScope, userId: string): Promise<void> {
    assertUuid(userId);
    await this.database.withScope(scope, async (client) => {
      const target = await this.lockTarget(client, scope, userId);
      if (!target.managedHere) {
        throw new ForbiddenException({ code: "USER_MANAGED_ELSEWHERE", message: "Esta cuenta pertenece a otra farmacia." });
      }
      await client.query(
        `update users set totp_secret = null, totp_pending_secret = null, totp_enabled_at = null, totp_last_step = null
         where id = $1`,
        [userId]
      );
      await revokeSessions(client, scope.tenantId, userId);
      await audit(client, scope, "user.two_factor_reset", userId, {});
    });
  }

  async createRole(scope: TenantScope, raw: RoleInput): Promise<{ id: string }> {
    const name = text(raw?.name, "name", 2, 120);
    const description = raw?.description === undefined ? "" : text(raw.description, "description", 0, 255);
    const permissions = codeList(raw?.permissionCodes);
    return this.database.withScope(scope, async (client) => {
      await this.assertPermissionsAssignable(client, scope, permissions);
      const code = `custom-${randomBytes(4).toString("hex")}`;
      const { rows } = await client.query<{ id: string }>(
        "insert into roles (tenant_id, code, name, description, is_system) values ($1, $2, $3, $4, false) returning id",
        [scope.tenantId, code, name, description]
      );
      const roleId = rows[0]?.id as string;
      await setRolePermissions(client, roleId, permissions);
      await audit(client, scope, "role.created", roleId, { name, permissions });
      return { id: roleId };
    });
  }

  async updateRole(scope: TenantScope, roleId: string, raw: RoleInput): Promise<void> {
    assertUuid(roleId);
    const name = raw?.name === undefined ? undefined : text(raw.name, "name", 2, 120);
    const description = raw?.description === undefined ? undefined : text(raw.description, "description", 0, 255);
    const permissions = raw?.permissionCodes === undefined ? undefined : codeList(raw.permissionCodes);
    await this.database.withScope(scope, async (client) => {
      const role = await this.lockCustomRole(client, scope.tenantId, roleId);
      if (permissions) {
        await this.assertPermissionsAssignable(client, scope, permissions);
        await setRolePermissions(client, roleId, permissions);
      }
      await client.query(
        `update roles set name = coalesce($2, name), description = coalesce($3, description), updated_at = now() where id = $1`,
        [roleId, name ?? null, description ?? null]
      );
      await audit(client, scope, "role.updated", roleId, { name: name ?? role.name, permissions });
    });
  }

  async deleteRole(scope: TenantScope, roleId: string): Promise<void> {
    assertUuid(roleId);
    await this.database.withScope(scope, async (client) => {
      const role = await this.lockCustomRole(client, scope.tenantId, roleId);
      const assigned = await client.query("select 1 from user_roles where tenant_id = $1 and role_id = $2 limit 1", [scope.tenantId, roleId]);
      if (assigned.rowCount) {
        throw new ConflictException({ code: "ROLE_IN_USE", message: "Quita este rol a sus usuarios antes de eliminarlo." });
      }
      await client.query("delete from role_permissions where role_id = $1", [roleId]);
      await client.query("delete from roles where id = $1", [roleId]);
      await audit(client, scope, "role.deleted", roleId, { name: role.name });
    });
  }

  private async queryUsers(client: PoolClient, tenantId: string, userId?: string): Promise<TenantUser[]> {
    const { rows } = await client.query<TenantUser>(
      `select users.id, users.email, users.display_name as "displayName", users.is_active as "isActive",
              users.created_at as "createdAt", users.last_login_at as "lastLoginAt",
              users.totp_enabled_at is not null as "twoFactorEnabled",
              users.home_tenant_id is not distinct from $1::uuid as "managedHere",
              coalesce((
                select json_agg(json_build_object('id', roles.id, 'code', roles.code, 'name', roles.name) order by roles.name)
                from user_roles join roles on roles.id = user_roles.role_id
                where user_roles.user_id = users.id and user_roles.tenant_id = $1
              ), '[]'::json) as roles,
              coalesce((
                select json_agg(json_build_object('id', branches.id, 'code', branches.code, 'name', branches.name) order by branches.code)
                from user_branch_memberships as membership
                join branches on branches.tenant_id = membership.tenant_id and branches.id = membership.branch_id
                where membership.user_id = users.id and membership.tenant_id = $1
              ), '[]'::json) as branches
       from users
       where ($2::uuid is null or users.id = $2)
       order by users.is_active desc, users.display_name`,
      [tenantId, userId ?? null]
    );
    return rows;
  }

  private async queryRoles(client: PoolClient, tenantId: string, roleIds?: string[]): Promise<TenantRole[]> {
    const { rows } = await client.query<TenantRole>(
      `select roles.id, roles.code, coalesce(nullif(roles.name, ''), roles.code) as name, roles.description,
              roles.is_system as "isSystem",
              coalesce((select array_agg(permission_code order by permission_code) from role_permissions where role_id = roles.id), '{}') as permissions,
              (select count(*)::int from user_roles where role_id = roles.id and tenant_id = $1) as users
       from roles
       where roles.tenant_id = $1 and ($2::uuid[] is null or roles.id = any($2::uuid[]))
       order by roles.is_system desc, roles.name`,
      [tenantId, roleIds ?? null]
    );
    return rows;
  }

  private async lockTarget(client: PoolClient, scope: TenantScope, userId: string): Promise<TenantUser> {
    const [target] = await this.queryUsers(client, scope.tenantId, userId);
    if (!target || (!target.managedHere && !target.branches.length)) {
      throw new NotFoundException({ code: "USER_NOT_FOUND", message: "El usuario no existe en esta farmacia." });
    }
    // No se administra a alguien con más permisos que uno mismo.
    const actor = await actorPermissions(client, scope);
    const targetPermissions = await client.query<{ code: string }>(
      `select distinct role_permissions.permission_code as code
       from user_roles join role_permissions on role_permissions.role_id = user_roles.role_id
       where user_roles.user_id = $1 and user_roles.tenant_id = $2`,
      [userId, scope.tenantId]
    );
    if (targetPermissions.rows.some((row) => !actor.has(row.code))) {
      throw new ForbiddenException({ code: "INSUFFICIENT_PRIVILEGES", message: "Ese usuario tiene permisos que tú no tienes." });
    }
    return target;
  }

  private async lockCustomRole(client: PoolClient, tenantId: string, roleId: string): Promise<{ name: string }> {
    const { rows } = await client.query<{ name: string; isSystem: boolean }>(
      `select name, is_system as "isSystem" from roles where tenant_id = $1 and id = $2 for update`,
      [tenantId, roleId]
    );
    const role = rows[0];
    if (!role) {
      throw new NotFoundException({ code: "ROLE_NOT_FOUND", message: "El rol no existe." });
    }
    if (role.isSystem) {
      throw new ConflictException({ code: "SYSTEM_ROLE", message: "Los roles predefinidos no se pueden modificar. Crea un rol personalizado." });
    }
    return role;
  }

  private async assertRolesAssignable(client: PoolClient, scope: TenantScope, roleIds: string[]): Promise<void> {
    if (!roleIds.length) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "roleIds", message: "Asigna al menos un rol." });
    }
    const roles = await this.queryRoles(client, scope.tenantId, roleIds);
    if (roles.length !== roleIds.length) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "roleIds", message: "Alguno de los roles no existe." });
    }
    await this.assertPermissionsAssignable(client, scope, roles.flatMap((role) => role.permissions));
  }

  private async assertPermissionsAssignable(client: PoolClient, scope: TenantScope, permissions: string[]): Promise<void> {
    const known = await client.query<{ code: string }>("select code from permissions where code = any($1::text[])", [permissions]);
    if (known.rowCount !== new Set(permissions).size) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "permissionCodes", message: "Algún permiso no existe." });
    }
    const actor = await actorPermissions(client, scope);
    const missing = permissions.filter((permission) => !actor.has(permission));
    if (missing.length) {
      throw new ForbiddenException({
        code: "INSUFFICIENT_PRIVILEGES",
        message: "No puedes otorgar permisos que tú no tienes.",
        details: [...new Set(missing)]
      });
    }
  }

  private async assertBranchesExist(client: PoolClient, tenantId: string, branchIds: string[]): Promise<void> {
    if (!branchIds.length) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "branchIds", message: "Asigna al menos una sucursal." });
    }
    const { rowCount } = await client.query(
      "select 1 from branches where tenant_id = $1 and id = any($2::uuid[]) and is_active",
      [tenantId, branchIds]
    );
    if (rowCount !== branchIds.length) {
      throw new BadRequestException({ code: "INVALID_INPUT", field: "branchIds", message: "Alguna sucursal no existe o está inactiva." });
    }
  }

  private async replaceAccess(client: PoolClient, tenantId: string, userId: string, roleIds?: string[], branchIds?: string[]): Promise<void> {
    if (roleIds) {
      await client.query("delete from user_roles where tenant_id = $1 and user_id = $2 and not (role_id = any($3::uuid[]))", [tenantId, userId, roleIds]);
      for (const roleId of roleIds) {
        await client.query(
          "insert into user_roles (user_id, tenant_id, role_id) values ($1, $2, $3) on conflict do nothing",
          [userId, tenantId, roleId]
        );
      }
    }
    if (branchIds) {
      await client.query(
        "delete from user_branch_memberships where tenant_id = $1 and user_id = $2 and not (branch_id = any($3::uuid[]))",
        [tenantId, userId, branchIds]
      );
      for (const branchId of branchIds) {
        await client.query(
          "insert into user_branch_memberships (user_id, tenant_id, branch_id) values ($1, $2, $3) on conflict do nothing",
          [userId, tenantId, branchId]
        );
      }
    }
  }

  private async assertActiveOwnerRemains(client: PoolClient, tenantId: string): Promise<void> {
    const { rowCount } = await client.query(
      `select 1 from user_roles
       join roles on roles.id = user_roles.role_id and roles.code = $2 and roles.is_system
       join users on users.id = user_roles.user_id and users.is_active
       where user_roles.tenant_id = $1
       limit 1`,
      [tenantId, ownerRoleCode]
    );
    if (!rowCount) {
      throw new ConflictException({ code: "LAST_OWNER", message: "La farmacia debe conservar al menos un Propietario activo." });
    }
  }

  /** Traduce errores de base de datos y de cuota a respuestas claras. */
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      if (pg.code === "23505" && pg.constraint === "users_email_unique") {
        throw new ConflictException({ code: "EMAIL_TAKEN", field: "email", message: "Ya existe una cuenta con ese correo." });
      }
      if (pg.code === "23503") {
        throw new ConflictException({
          code: "ACCESS_IN_USE",
          message: "No se puede quitar esa sucursal: el usuario tiene turnos de caja registrados allí."
        });
      }
      if (error instanceof QuotaExceededError) {
        throw new HttpException(
          { statusCode: 409, code: "PLAN_QUOTA_EXCEEDED", message: "Tu plan no permite más usuarios activos. Sube de plan o desactiva a alguien." },
          HttpStatus.CONFLICT
        );
      }
      if (error instanceof SubscriptionAccessError) {
        throw new HttpException(
          { statusCode: 402, code: "SUBSCRIPTION_INACTIVE", message: "La suscripción de la farmacia no está activa." },
          HttpStatus.PAYMENT_REQUIRED
        );
      }
      throw error;
    }
  }
}

async function actorPermissions(client: PoolClient, scope: TenantScope): Promise<Set<string>> {
  const { rows } = await client.query<{ code: string }>(
    `select distinct role_permissions.permission_code as code
     from user_roles join role_permissions on role_permissions.role_id = user_roles.role_id
     where user_roles.user_id = $1 and user_roles.tenant_id = $2`,
    [scope.userId, scope.tenantId]
  );
  return new Set(rows.map((row) => row.code));
}

async function setRolePermissions(client: PoolClient, roleId: string, permissions: string[]): Promise<void> {
  await client.query("delete from role_permissions where role_id = $1", [roleId]);
  for (const permission of new Set(permissions)) {
    await client.query("insert into role_permissions (role_id, permission_code) values ($1, $2)", [roleId, permission]);
  }
}

async function revokeSessions(client: PoolClient, tenantId: string, userId: string): Promise<void> {
  await client.query(
    "update auth_sessions set revoked_at = now() where user_id = $1 and tenant_id = $2 and revoked_at is null",
    [userId, tenantId]
  );
}

async function audit(client: PoolClient, scope: TenantScope, action: string, entityId: string, payload: Record<string, unknown>): Promise<void> {
  await client.query(
    `insert into audit_events (tenant_id, branch_id, actor_user_id, action, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [scope.tenantId, scope.branchId, scope.userId, action, action.split(".")[0], entityId, JSON.stringify(payload)]
  );
}

function text(value: unknown, field: string, min: number, max: number): string {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (trimmed.length < min || trimmed.length > max) {
    throw new BadRequestException({ code: "INVALID_INPUT", field, message: `Revisa el campo ${field}.` });
  }
  return trimmed;
}

function email(value: unknown): string {
  const normalized = text(value, "email", 5, 254).toLowerCase();
  if (!emailPattern.test(normalized)) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "email", message: "El correo no es válido." });
  }
  return normalized;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new BadRequestException({ code: "INVALID_INPUT", field, message: "Valor no válido." });
  }
  return value;
}

function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some((id) => typeof id !== "string" || !uuidPattern.test(id))) {
    throw new BadRequestException({ code: "INVALID_INPUT", field, message: "Selección no válida." });
  }
  return [...new Set(value as string[])];
}

function codeList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((code) => typeof code !== "string")) {
    throw new BadRequestException({ code: "INVALID_INPUT", field: "permissionCodes", message: "Selección de permisos no válida." });
  }
  return [...new Set(value as string[])];
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) {
    throw new NotFoundException();
  }
}
