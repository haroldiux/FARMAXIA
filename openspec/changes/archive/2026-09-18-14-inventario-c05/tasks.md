# Tareas — Inventario operativo C05

## Fase 1 — Base y pruebas rojas

- [x] 1.1 Extender el fixture de inventario y escribir pruebas rojas de
  alertas por horizonte, orden, estado y aislamiento.
- [x] 1.2 Escribir pruebas rojas de cuarentena/liberación, motivo de cadena de
  frío, reservas activas, idempotencia y auditoría.
- [x] 1.3 Escribir pruebas rojas de merma libre, merma sobre reservado,
  movimiento `WASTE`, replay/conflicto y saldo no negativo.
- [x] 1.4 Escribir prueba roja de `POST /reconciliations` para conteo
  autorizado y replay.

## Fase 2 — Persistencia y seguridad

- [x] 2.1 Añadir `inventory_operation_events` al schema Drizzle y generar
  migración `0010`.
- [x] 2.2 Restringir estados de lote, crear índices, FKs compuestas, RLS y
  privilegios mínimos; actualizar DBML.
- [x] 2.3 Verificar migración sobre PostgreSQL limpio y ya migrado, sin cambiar
  `0001..0009`.

## Fase 3 — Servicios transaccionales

- [x] 3.1 Implementar `listExpiryAlerts` con horizonte inclusivo y fechas
  deterministas.
- [x] 3.2 Implementar cuarentena/liberación con locks, motivo, frío,
  idempotencia y auditoría.
- [x] 3.3 Implementar `recordWaste` con condición de stock libre, movimiento
  OUT y evento transaccional.
- [x] 3.4 Exponer reconciliación de conteo mediante el controller existente y
  mantener `inventory.manage`/RLS.

## Fase 4 — Verificación y documentación

- [x] 4.1 Ejecutar suite API contra PostgreSQL real y comprobar aislamiento,
  concurrencia e idempotencia.
- [x] 4.2 Ejecutar typecheck, builds API/Web, `drizzle-kit check` y Compose
  con healthchecks.
- [x] 4.3 Actualizar especificación canónica, `ESTADO_IMPLEMENTACION.md`,
  `docs/sdd/tasks.md` y reporte de verificación.
- [x] 4.4 Archivar el change y publicar un commit convencional después de
  verificar todo el lote.
