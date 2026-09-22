# Matriz de pruebas y criterios de aceptación

| Grupo | Escenarios | Evidencia |
| --- | --- | --- |
| Aislamiento | T01, T02 | Integración contra PostgreSQL real con rol de aplicación y RLS; respuestas y ausencia de mutaciones. |
| Cuotas | T03, T23 | Transacciones concurrentes y actualización atómica. |
| Inventario | T04–T07 | Dominio/concurrencia PostgreSQL; saldos y asignaciones por lote. |
| Venta/documentos | T08–T10, T13–T18, T22 | API con idempotencia, outbox y dobles del proveedor fiscal/impresión. |
| Proformas | T11, T12 | Cotizar no cambia venta, caja ni stock; reservas solo si D09 se aprueba. |
| Pagos | T19, T25 | Estados explícitos y callbacks repetidos; una imagen no confirma pago. |
| Regencia/traspasos | T20, T21 | Se habilitan tras D13/D15. |
| Resiliencia | T16, T24, T26 | Fallos tras commit, restauración aislada y offline solo si se aprueba. |
| Evolución | T27 | Devoluciones ajustan beneficios una vez. |
| Reporte global de inventario | F9 | Permiso dedicado, agregación cross-branch, RLS cross-tenant, reservas, paginación y cadenas exactas. |

## Criterios C05

- Las alertas de vencimiento respetan horizonte, orden, stock físico y RLS sin
  persistir notificaciones.
- Cuarentena/cadena de frío rechaza reservas activas, registra motivo y
  temperatura cuando corresponde, y permite liberar solo lotes no vencidos.
- Mermas decrementan únicamente stock libre y registran exactamente un evento,
  movimiento `WASTE`/`OUT` y auditoría por clave idempotente.
- El conteo físico expuesto conserva el límite de `reserved_base` y es replay-safe.

## Criterios B01

- `GET /health` devuelve el contrato S01.
- `pnpm --filter @farmaxia/api test` pasa.
- Los builds de API y web pasan.
- Docker Compose valida y levanta PostgreSQL/Redis sin secretos comprometidos.

No se marca una prueba aprobada sin comando, salida y evidencia real.

## Criterios B03

- Login válido emite access token y refresh solamente para la membresía exacta.
- El rol de autenticación no enumera usuarios ni sesiones sin los settings locales
  de la transacción que limitan email o hash de refresh.
- Refresh rota la sesión y un replay se rechaza; una ruta privada sin bearer se
  rechaza.

## Criterios B04

- Sin contexto de tenant, usuario y sucursal, el rol de aplicación no ve recursos
  operativos de sucursal.
- Un job o archivo de tenant/sucursal A no es visible ni relacionable desde B.
- Cada clave de caché contiene tenant y sucursal, y rechaza segmentos vacíos o
  ambiguos.


## Criterios F8

- El catálogo rechaza intervalos solapados del mismo producto/presentación y
  alcance, permite el borde adyacente y mantiene la precedencia de sucursal
  sobre lista global.
- Las mutaciones de lista, precio y código de barras son idempotentes, generan
  auditoría y no escapan su tenant o sucursal bajo RLS.
- Los montos se transportan como cadenas decimales de hasta cuatro posiciones;
  la Web no convierte importes a `number`.
- La consulta por código devuelve solo productos/presentaciones activos y el
  precio vigente del alcance de la sesión.

## Criterios F9

- El permiso `inventory.report.global` permite leer todas las sucursales del
  tenant sin ampliar `inventory.manage` ni modificar inventario.
- Las filas, subtotales y total reconcilian físico, reservado y disponible como
  cadenas exactas; búsqueda y paginación conservan orden determinista.
- RLS oculta saldos, lotes, productos, presentaciones, almacenes y sucursales de
  otros tenants, incluso ante SQL directo con el rol de aplicación.
