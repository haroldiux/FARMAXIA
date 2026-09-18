# Verification report — C03

## Result

PASS — implementation matches the C03 proposal, specification and design.

## Evidence

- `pnpm --filter @farmaxia/api test`: 28 tests passed in 11 suites against PostgreSQL 18.
- `pnpm --filter @farmaxia/api build`: passed.
- `pnpm --filter @farmaxia/web build`: passed.
- `pnpm --filter @farmaxia/api exec tsc --noEmit`: passed through the API build/typecheck.
- `drizzle-kit check`: passed with `DATABASE_URL` configured.
- `db:migrate` applied `0008_messy_mauler.sql`; a second run completed without pending changes.

## Contract checks

- Movement direction is explicit and receipt movements are `IN`.
- Reconciliation updates balance and adjustment movement atomically.
- `OUT` adjustments preserve `reserved_base` and reject insufficient free stock.
- Replays are idempotent and audit evidence is append-only.
- Tenant/sucursal RLS and composite FKs are present on the reconciliation table.
- D08 costing and D22 historical import remain explicitly open.
