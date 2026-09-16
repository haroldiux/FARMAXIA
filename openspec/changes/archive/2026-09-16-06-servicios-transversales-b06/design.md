# Diseño Técnico: B06 — Servicios Transversales Confiables

## Componentes y Modelo de Datos

### 1. `audit_events`
- **Campos:**
  - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - `tenant_id`: UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  - `branch_id`: UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  - `actor_user_id`: UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `action`: VARCHAR(100) NOT NULL (e.g. `SALE_CREATED`, `CASH_SHIFT_OPENED`)
  - `entity_type`: VARCHAR(100) NOT NULL (e.g. `Sale`, `CashShift`)
  - `entity_id`: VARCHAR(100) NOT NULL
  - `payload`: JSONB NOT NULL DEFAULT '{}'
  - `occurred_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Restricciones y RLS:**
  - FK compuesta: `(tenant_id, branch_id) REFERENCES branches(tenant_id, id)`
  - Constraint UNIQUE: `(tenant_id, id)`
  - RLS activada y forzada: lectura e inserción filtradas por `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` y `branch_id = nullif(current_setting('app.branch_id', true), '')::uuid`.
  - Trigger de inmutabilidad:
    ```sql
    CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'audit_events is append-only and cannot be updated or deleted';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
    ```

### 2. `idempotency_records`
- **Campos:**
  - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - `tenant_id`: UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  - `branch_id`: UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  - `user_id`: UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `operation`: VARCHAR(100) NOT NULL
  - `idempotency_key`: VARCHAR(255) NOT NULL
  - `request_hash`: VARCHAR(64) NOT NULL (SHA-256 en hex del JSON canónico)
  - `status_code`: INTEGER NOT NULL
  - `response_payload`: JSONB NOT NULL
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Restricciones:**
  - UNIQUE `(tenant_id, operation, idempotency_key)`
  - FK compuesta `(tenant_id, branch_id) REFERENCES branches(tenant_id, id)`
  - RLS activada y forzada.

### 3. `outbox_events`
- **Campos:**
  - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - `tenant_id`: UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  - `branch_id`: UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  - `aggregate_type`: VARCHAR(100) NOT NULL
  - `aggregate_id`: VARCHAR(100) NOT NULL
  - `event_type`: VARCHAR(100) NOT NULL
  - `payload`: JSONB NOT NULL
  - `status`: VARCHAR(20) NOT NULL DEFAULT 'PENDING'
  - `retry_count`: INTEGER NOT NULL DEFAULT 0
  - `scheduled_for`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
  - `processed_at`: TIMESTAMPTZ
  - `created_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Restricciones:**
  - FK compuesta `(tenant_id, branch_id) REFERENCES branches(tenant_id, id)`
  - RLS activada y forzada.

### 4. `document_sequences`
- **Campos:**
  - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
  - `tenant_id`: UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  - `branch_id`: UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE
  - `document_type`: VARCHAR(50) NOT NULL (e.g. `NON_FISCAL_RECEIPT`, `PROFORMA`)
  - `current_number`: BIGINT NOT NULL DEFAULT 0
  - `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT NOW()
- **Restricciones y Concurrencia:**
  - UNIQUE `(tenant_id, branch_id, document_type)`
  - Asignación atómica mediante:
    ```sql
    INSERT INTO document_sequences (tenant_id, branch_id, document_type, current_number, updated_at)
    VALUES ($1, $2, $3, 1, NOW())
    ON CONFLICT (tenant_id, branch_id, document_type)
    DO UPDATE SET current_number = document_sequences.current_number + 1, updated_at = NOW()
    RETURNING current_number;
    ```
  - Bloquea la fila específica durante la transacción, garantizando secuencias estrictas sin colisiones.

## Servicios en `apps/api/src/transversal`

1. `AuditService`:
   - `recordInTransaction(tx: TenantTransactionContext, data: CreateAuditDto): Promise<AuditEvent>`
2. `IdempotencyService`:
   - `execute<T>(scope: TenantScope, operation: string, key: string, payload: unknown, fn: (tx: TenantTransactionContext) => Promise<{ statusCode: number; data: T }>): Promise<{ statusCode: number; data: T }>`
3. `OutboxService`:
   - `enqueueInTransaction(tx: TenantTransactionContext, data: CreateOutboxDto): Promise<OutboxEvent>`
4. `DocumentSequenceService`:
   - `nextNumberInTransaction(tx: TenantTransactionContext, documentType: string): Promise<bigint>`
