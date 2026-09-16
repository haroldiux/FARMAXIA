schema: gentle-ai.verify-result/v1
verdict: pass
blockers: 0
critical_findings: 0
requirements: 4/4
scenarios: 5/5
test_command: pnpm --filter @farmaxia/api test
test_exit_code: 0
build_command: pnpm build
build_exit_code: 0

# Verification Report: C02 Compras y recepción

## Evidence

- La suite completa pasó con 10 suites y 26 pruebas contra PostgreSQL 18 real.
- La prueba C02 verificó proveedor, orden, recepción por lote, incremento único
  del saldo, movimiento `RECEIPT`, replay idempotente y cuenta por pagar.
- Cantidades/costos inválidos fallan antes de alterar inventario.
- `drizzle-kit check`, typecheck de API/web y builds de producción pasaron.
- `db:migrate` se ejecutó de forma repetible; no se integraron pagos, importación
  histórica, costeo definitivo, FEFO ni proveedores externos.
