# Especificación — Inventario operativo C05

## C05.1 — Alertas de vencimiento

El sistema DEBE exponer una consulta de alertas por almacén y horizonte de
días (`0..365`). La consulta DEBE ejecutarse dentro de `withScope`, incluir
solo lotes del tenant/sucursal activa con existencia física positiva y ordenar
por `expires_on ASC, batch_id ASC`.

Cada alerta DEBE devolver lote, fecha de vencimiento, estado del lote,
existencia física, existencia reservada y existencia disponible. Debe marcarse
como `EXPIRED` cuando la fecha ya pasó y como `DUE_SOON` cuando vence dentro
del horizonte; no se deben crear notificaciones persistidas ni mutar saldos.

**Escenario: alerta scoped**

- **Dado** dos lotes de la sucursal, uno dentro del horizonte y otro fuera
- **Cuando** el usuario consulta el horizonte autorizado
- **Entonces** solo recibe el lote dentro del horizonte, ordenado por fecha,
  sin ver datos de otro tenant o sucursal.

## C05.2 — Cuarentena y cadena de frío

Un lote `AVAILABLE` DEBE poder pasar a `QUARANTINED` con motivo obligatorio y
una operación idempotente. El motivo DEBE aceptar `QUALITY`, `COLD_CHAIN`,
`DAMAGE` o `OTHER`; para `COLD_CHAIN` se DEBE poder registrar una temperatura
medida en grados Celsius.

La transición DEBE bloquear el lote y rechazar la cuarentena si existe una
reserva activa en ese lote/sucursal. Liberar la cuarentena DEBE requerir motivo,
rechazar lotes vencidos y devolver el lote a `AVAILABLE`. Una transición
repetida con la misma clave y payload DEBE devolver el resultado original; una
clave reutilizada con payload distinto DEBE producir conflicto. Cada transición
DEBE registrar evento y auditoría.

**Escenario: cuarentena con reserva**

- **Dado** un lote con unidades reservadas activas
- **Cuando** se intenta ponerlo en cuarentena
- **Entonces** la operación falla sin cambiar estado, saldo, reserva ni
  auditoría.

**Escenario: liberación de frío**

- **Dado** un lote `QUARANTINED` no vencido con motivo `COLD_CHAIN`
- **Cuando** se registra la revisión y se libera la cuarentena
- **Entonces** el lote queda `AVAILABLE` y la operación queda auditada.

## C05.3 — Mermas

Una merma DEBE recibir almacén, lote, cantidad base positiva, motivo y clave de
idempotencia. La transacción DEBE bloquear el saldo y permitir únicamente
`quantity_base - reserved_base >= quantity`; nunca puede decrementar reservas ni
crear saldo negativo.

La merma DEBE decrementar `quantity_base`, insertar un movimiento `WASTE` con
dirección `OUT`, registrar evento/auditoría y devolver el saldo resultante. Un
replay idéntico no debe duplicar efectos; un conflicto de payload debe
rechazarse.

**Escenario: merma libre**

- **Dado** un saldo con stock libre suficiente
- **Cuando** se registra una merma
- **Entonces** baja el stock físico, las reservas no cambian y existe un único
  movimiento `WASTE` auditado.

**Escenario: merma sobre reservado**

- **Dado** que la cantidad solicitada supera el stock libre
- **Cuando** se registra la merma
- **Entonces** falla de forma atómica y no se inserta movimiento ni evento.

## C05.4 — Conteo físico autorizado

El sistema DEBE exponer el conteo físico mediante la reconciliación idempotente
existente, protegido por `inventory.manage`. El conteo DEBE guardar esperado,
contado, delta y motivo; un delta `OUT` no puede reducir por debajo de
`reserved_base` y un replay no debe duplicar movimiento ni auditoría.

**Escenario: conteo con diferencia**

- **Dado** un saldo y un conteo autorizado con motivo
- **Cuando** se confirma el conteo
- **Entonces** la diferencia se aplica en la misma transacción que su
  reconciliación, movimiento y auditoría.

## C05.5 — Seguridad y consistencia

Todas las mutaciones DEBEN usar `TenantDatabase.withScope`, RLS, FKs
compuestas, idempotencia y auditoría transaccional. FEFO DEBE seguir excluyendo
lotes `QUARANTINED` y cualquier operación debe respetar la membresía activa de
sucursal. El endpoint de cada mutación DEBE requerir `inventory.manage`.

## Fuera de alcance

C05 no implementa sensores IoT, workers de notificación, ventas/proformas,
transferencias, costeo D08, importación D22 ni una pantalla web. Tampoco cambia
automáticamente el estado por fecha vencida: la alerta informa la condición y
la decisión de cuarentena permanece explícita.
