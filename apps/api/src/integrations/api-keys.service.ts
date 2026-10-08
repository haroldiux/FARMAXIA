import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { TenantDatabase, type TenantScope } from "../database/tenant-database.js";
import { AuditService } from "../transversal/audit.service.js";

/** Provisional D78: requests per key per minute on the public API. */
export const API_KEY_RATE_LIMIT_PER_MINUTE = 120;
export const API_KEY_PREFIX = "fxk_";
/** `fxk_` + 32 random bytes in base64url (43 characters). */
export const API_KEY_PATTERN = /^fxk_[A-Za-z0-9_-]{43}$/;
const DISPLAY_PREFIX_LENGTH = 12;
const NAME_MAX_LENGTH = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Management view of a key. Never carries the plaintext key nor its hash. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** First characters of the key, to recognise it in lists. */
  prefix: string;
  branchId: string;
  createdByUserId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Returned only by create: `key` is the plaintext, shown once. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

const summaryColumns = `id, name, key_prefix as prefix, branch_id as "branchId", created_by_user_id as "createdByUserId",
  created_at as "createdAt", last_used_at as "lastUsedAt", revoked_at as "revokedAt"`;

/**
 * F19 (D77): API keys belong to the session branch and act as their creator in that branch.
 * Only the SHA-256 hash is stored; the plaintext is returned once, on creation.
 */
@Injectable()
export class ApiKeysService {
  private readonly audit = new AuditService();

  constructor(@Inject(TenantDatabase) private readonly database: TenantDatabase) {}

  list(scope: TenantScope): Promise<{ items: ApiKeySummary[] }> {
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<ApiKeySummary>(
        `select ${summaryColumns} from api_keys
         where tenant_id = $1 and branch_id = $2
         order by created_at desc, id desc`,
        [scope.tenantId, scope.branchId]
      );
      return { items: result.rows };
    });
  }

  create(scope: TenantScope, input: { name?: unknown }): Promise<CreatedApiKey> {
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
      throw new BadRequestException({
        code: "INVALID_API_KEY_NAME",
        message: `El nombre debe tener entre 1 y ${NAME_MAX_LENGTH} caracteres.`,
        field: "name"
      });
    }
    const key = generateApiKey();
    const prefix = key.slice(0, DISPLAY_PREFIX_LENGTH);
    return this.database.withScope(scope, async (client) => {
      const result = await client.query<ApiKeySummary>(
        `insert into api_keys (tenant_id, branch_id, created_by_user_id, name, key_prefix, key_hash)
         values ($1, $2, $3, $4, $5, $6)
         returning ${summaryColumns}`,
        [scope.tenantId, scope.branchId, scope.userId, name, prefix, hashApiKey(key)]
      );
      const created = result.rows[0]!;
      await this.audit.recordInTransaction(client, scope, {
        action: "integrations.api_key.created",
        entityType: "api_key",
        entityId: created.id,
        payload: { name, prefix }
      });
      return { ...created, key };
    });
  }

  /** Idempotent: revoking an already revoked key returns it unchanged (audited once). */
  revoke(scope: TenantScope, keyId: string): Promise<ApiKeySummary> {
    if (!uuidPattern.test(keyId)) {
      throw new BadRequestException({ code: "INVALID_API_KEY_ID", message: "La clave de API no es válida.", field: "id" });
    }
    return this.database.withScope(scope, async (client) => {
      const revoked = await client.query<ApiKeySummary>(
        `update api_keys set revoked_at = now(), revoked_by_user_id = $3
         where tenant_id = $1 and id = $2 and revoked_at is null
         returning ${summaryColumns}`,
        [scope.tenantId, keyId, scope.userId]
      );
      if (revoked.rows[0]) {
        await this.audit.recordInTransaction(client, scope, {
          action: "integrations.api_key.revoked",
          entityType: "api_key",
          entityId: keyId,
          payload: { name: revoked.rows[0].name, prefix: revoked.rows[0].prefix }
        });
        return revoked.rows[0];
      }
      return this.load(client, scope, keyId);
    });
  }

  private async load(client: PoolClient, scope: TenantScope, keyId: string): Promise<ApiKeySummary> {
    const result = await client.query<ApiKeySummary>(`select ${summaryColumns} from api_keys where tenant_id = $1 and id = $2`, [scope.tenantId, keyId]);
    if (!result.rows[0]) {
      throw new NotFoundException({ code: "API_KEY_NOT_FOUND", message: "Clave de API no encontrada." });
    }
    return result.rows[0];
  }
}
