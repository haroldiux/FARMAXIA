import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AuditService } from "../transversal/audit.service.js";
import { OutboxService } from "../transversal/outbox.service.js";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import {
  consumeQuota,
  QuotaExceededError,
  releaseQuota,
  SubscriptionAccessError
} from "../subscriptions/quota.service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

@Injectable()
export class BranchesService {
  private readonly audit = new AuditService();
  private readonly outbox = new OutboxService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  async listBranches(scope: TenantScope): Promise<TenantBranchSummary[]> {
    return this.database.withScope(scope, async (client) => {
      const { rows } = await client.query<TenantBranchSummary>(
        `select id, code, name, is_active as "isActive", created_at as "createdAt"
         from branches
         where tenant_id = $1
         order by code asc, id asc`,
        [scope.tenantId]
      );
      return rows;
    });
  }

  async createBranch(scope: TenantScope, input: CreateBranchInput): Promise<TenantBranchSummary> {
    const code = input?.code?.trim().toUpperCase();
    if (!code || code.length > 32 || !/^[A-Z0-9_\-\.]+$/.test(code)) {
      throw new BadRequestException("El código de la sucursal debe tener entre 1 y 32 caracteres alfanuméricos.");
    }
    const name = input?.name?.trim();
    if (!name || name.length > 160) {
      throw new BadRequestException("El nombre de la sucursal debe tener entre 1 y 160 caracteres.");
    }

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

      let legalEntityId = input.legalEntityId;
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
        if (!uuidPattern.test(legalEntityId)) {
          throw new NotFoundException("Entidad legal no válida.");
        }
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

      await this.audit.recordInTransaction(client, scope, {
        action: "branch.created",
        entityType: "branch",
        entityId: created.id,
        payload: {
          code: created.code,
          name: created.name,
          initialRegisterCreated
        }
      });

      await this.outbox.enqueueInTransaction(client, scope, {
        aggregateType: "branch",
        aggregateId: created.id,
        eventType: "branch.created",
        payload: {
          id: created.id,
          code: created.code,
          name: created.name,
          initialRegisterCreated
        }
      });

      return { ...created, initialRegisterCreated };
    });
  }

  async updateBranch(scope: TenantScope, branchId: string, input: UpdateBranchInput): Promise<TenantBranchSummary> {
    if (!uuidPattern.test(branchId)) {
      throw new NotFoundException("Sucursal no encontrada.");
    }

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
      if (input.code !== undefined) {
        const trimmedCode = input.code.trim().toUpperCase();
        if (!trimmedCode || trimmedCode.length > 32 || !/^[A-Z0-9_\-\.]+$/.test(trimmedCode)) {
          throw new BadRequestException("El código de la sucursal debe tener entre 1 y 32 caracteres alfanuméricos.");
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
      if (input.name !== undefined) {
        const trimmedName = input.name.trim();
        if (!trimmedName || trimmedName.length > 160) {
          throw new BadRequestException("El nombre de la sucursal debe tener entre 1 y 160 caracteres.");
        }
        newName = trimmedName;
      }

      let newActive = current.isActive;
      if (input.isActive !== undefined && input.isActive !== current.isActive) {
        if (!input.isActive) {
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

      await this.audit.recordInTransaction(client, scope, {
        action: "branch.updated",
        entityType: "branch",
        entityId: branchId,
        payload: {
          previous: { code: current.code, name: current.name, isActive: current.isActive },
          next: { code: updated.code, name: updated.name, isActive: updated.isActive }
        }
      });

      await this.outbox.enqueueInTransaction(client, scope, {
        aggregateType: "branch",
        aggregateId: branchId,
        eventType: "branch.updated",
        payload: {
          id: branchId,
          code: updated.code,
          name: updated.name,
          isActive: updated.isActive
        }
      });

      return updated;
    });
  }
}
