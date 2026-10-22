# Guía de pruebas manuales — FARMAXIA

Guía para probar **todo el sistema** a mano, en el navegador, módulo por módulo.

**Cómo usarla**

1. Sigue los módulos **en orden**: varios dependen de datos creados en los anteriores (por ejemplo, el producto que creas en Catálogo es el que luego compras y vendes).
2. Cada prueba tiene un código (`M2-03`), los **pasos** y el **resultado esperado**.
3. Marca la casilla `[x]` cuando la prueba salga bien. Si falla, anótala en la sección **Registro de fallos** al final.
4. Los textos entre comillas («…») son los textos reales de la pantalla. Si ves uno distinto, anótalo.

**Leyenda**

- ✅ Debe funcionar.
- ⚠️ Salvedad conocida (el mensaje sale en inglés, o puede salir un error genérico). Pruébalo y anota qué ves.
- ⛔ No implementado. No hace falta probarlo.

---

## Índice

- [0. Preparación del entorno](#0-preparación-del-entorno)
- [M1. Acceso, cuenta, usuarios y auditoría](#m1-acceso-cuenta-usuarios-y-auditoría)
- [M2. Catálogo](#m2-catálogo)
- [M3. Inventario](#m3-inventario)
- [M4. Compras](#m4-compras)
- [M5. Caja y turnos](#m5-caja-y-turnos)
- [M6. Ventas POS, historial, devoluciones y proformas](#m6-ventas-pos-historial-devoluciones-y-proformas)
- [M7. Traspasos](#m7-traspasos)
- [M8. Medicamentos controlados](#m8-medicamentos-controlados)
- [M9. Personal: turnos, comisiones y productividad](#m9-personal-turnos-comisiones-y-productividad)
- [M10. Clientes, puntos y convenios](#m10-clientes-puntos-y-convenios)
- [M11. Analítica](#m11-analítica)
- [M12. Integraciones (API pública y webhooks)](#m12-integraciones-api-pública-y-webhooks)
- [M13. Suscripción y planes (lado farmacia)](#m13-suscripción-y-planes-lado-farmacia)
- [M14. Panel del operador SaaS (/platform)](#m14-panel-del-operador-saas-platform)
- [M15. Pruebas transversales](#m15-pruebas-transversales)
- [Funcionalidades no implementadas](#funcionalidades-no-implementadas)
- [Registro de fallos](#registro-de-fallos)

---

## 0. Preparación del entorno

### Servicios

| Servicio | Dirección |
|---|---|
| Web (lo que usas en el navegador) | http://localhost:3000 |
| API | http://localhost:3001 (salud: http://localhost:3001/health) |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6379 |

### Levantar el sistema

- [ ] **P-01** Abre **Docker Desktop** y espera a que diga que está corriendo.
- [ ] **P-02** En una terminal, dentro de la carpeta del proyecto:
  ```bash
  docker compose up -d --build
  docker compose ps
  ```
  **Esperado:** `web`, `api`, `postgres` y `redis` en estado `running` / `healthy`. La API aplica las migraciones sola al arrancar.
- [ ] **P-03** Abre http://localhost:3001/health. **Esperado:** responde OK.
- [ ] **P-04** **Solo si la base de datos es nueva** (nunca cargaste datos de ejemplo), ejecuta desde la carpeta del proyecto:
  ```bash
  pnpm install
  pnpm --filter @farmaxia/api db:seed
  docker compose restart api
  ```
  El `restart` hace que las alertas de vencimiento se generen enseguida (si no, tardan hasta 1 hora).

### Cuentas de prueba

| Quién | Dónde entra | Correo | Contraseña |
|---|---|---|---|
| Dueño de la farmacia (rol Propietario) | http://localhost:3000 | `admin@farmaxia.local` | `Admin1234!` |
| Operador SaaS (dueño de FARMAXIA) | http://localhost:3000/platform/login | `owner@farmaxia.local` | `Owner12345!` |

> No las mezcles: la cuenta de operador **no** entra por la pantalla de la farmacia, y al revés.

### Datos que ya trae el sistema (seed)

- Farmacia **Farmacia Central** (identificador `farmacia-central`), plan **COMPLETO** (todo habilitado, sin costo).
- Sucursal **SUC-001 «Casa Matriz»**, almacén **«Almacén Central»** (despacha ventas), caja **CAJA-01**.
- Producto **Paracetamol 500mg**, presentación **«Caja x 20 tabletas»** (factor 20), código de barras `7771234567890`, precio **Bs 15** en la «Lista General».
- Lotes: `LOTE-2026-A` (200 unidades, vence 2027-12-31) y `LOTE-2026-B` (30 unidades, **vence en 20 días**).
- Proveedor **Droguería Inti**.
- Un **turno de caja ya abierto** con Bs 100 de fondo, asignado al admin → puedes vender desde el primer minuto.

> **Unidades base:** el inventario se cuenta en unidades sueltas. Una «Caja x 20» = 20 unidades base.

---

## M1. Acceso, cuenta, usuarios y auditoría

**Qué hace:** controla quién entra al sistema, qué puede ver cada persona (roles y permisos) y deja registro de todo lo que pasa (auditoría).

**Dónde:** `/` (login), `/register`, `/dashboard` (Resumen), `/account` (Mi cuenta), `/users` (Usuarios y roles), `/audit` (Auditoría).

### Login

- [ ] **M1-01 Login correcto.** Entra a http://localhost:3000 con `admin@farmaxia.local` / `Admin1234!` y pulsa «Entrar al backoffice».
  **Esperado:** llegas al **Resumen** (`/dashboard`). Ves el menú lateral completo.
- [ ] **M1-02 Contraseña incorrecta.** Cierra sesión y entra con la contraseña `Mala1234!`.
  **Esperado:** «No pudimos iniciar la sesión. Verifica tus datos e inténtalo nuevamente.»
- [ ] **M1-03 Correo que no existe.** Usa `noexiste@farmaxia.local`.
  **Esperado:** **el mismo mensaje** que en M1-02 (el sistema no revela si el correo existe).
- [ ] **M1-04 Identificador de farmacia.** Pulsa «¿Trabajas en varias farmacias? Indica cuál», escribe `farmacia-central` y entra con el admin.
  **Esperado:** entra normalmente.
- [ ] **M1-05 Bloqueo por intentos.** Falla el login más de 10 veces seguidas.
  **Esperado:** «Demasiados intentos. Espera unos minutos e inténtalo de nuevo.» (Espera ~15 min antes de seguir, o hazlo al final del día.)

### Resumen

- [ ] **M1-06 Panel de inicio.** En `/dashboard` revisa las tarjetas.
  **Esperado:** «Ventas de hoy», «Productos activos», «Equipo», «Por vencer»; segunda fila «Ventas del mes», «Ticket promedio», «Unidades vendidas», «Sucursales»; paneles «Ventas por mes», «Alertas del sistema», «Ventas recientes» y «Tendencia». Si aún no vendiste: «Todavía no hay ventas en esta sucursal.»
- [ ] **M1-07 Alerta de vencimiento.** En «Alertas del sistema» y en la **campana** de la barra superior.
  **Esperado:** aparece el `LOTE-2026-B` con un chip de «N días».

### Mi cuenta

- [ ] **M1-08 Datos de la cuenta.** Ve a «Mi cuenta».
  **Esperado:** muestra farmacia, identificador y sucursal actual.
- [ ] **M1-09 Cambio de contraseña con error.** En el formulario, pon una contraseña actual incorrecta.
  **Esperado:** «La contraseña actual no es correcta.»
- [ ] **M1-10 Confirmación distinta.** Nueva contraseña y «Repítela» diferentes.
  **Esperado:** «La nueva contraseña y su confirmación no coinciden.»
- [ ] **M1-11 Misma contraseña.** Nueva contraseña igual a la actual.
  **Esperado:** «La nueva contraseña debe ser distinta a la actual.»
- [ ] **M1-12 Cambio correcto.** Cambia a `Admin12345!`.
  **Esperado:** «Contraseña actualizada. Cerramos tus sesiones en otros dispositivos.» Cierra sesión y entra con la nueva. **Luego vuelve a `Admin1234!`** para que el resto de la guía funcione.
- [ ] **M1-13 Verificación en dos pasos (2FA).** *(Necesitas Google Authenticator o similar en el celular.)* Pulsa «Configurar», escanea el QR, escribe el código y pulsa «Activar».
  **Esperado:** «Verificación en dos pasos activada…». Al volver a entrar, te pide el código de 6 dígitos («Verificar y entrar»).
- [ ] **M1-14 Código 2FA incorrecto.** En el login, pon un código inventado.
  **Esperado:** «El código no es válido o ya fue usado.»
- [ ] **M1-15 Desactivar 2FA.** En Mi cuenta, escribe tu contraseña y pulsa «Desactivar».
  **Esperado:** se desactiva. Con contraseña incorrecta: «La contraseña no es correcta.»
- [ ] **M1-16 Sesiones activas.** Entra con el admin desde otro navegador (o ventana de incógnito). En Mi cuenta → «Sesiones activas» pulsa «Cerrar» en la otra sesión.
  **Esperado:** la otra sesión desaparece de la lista; ese navegador queda fuera en menos de 15 minutos.

### Usuarios y roles

- [ ] **M1-17 Crear un cajero.** `/users` → «+ Nuevo usuario». Nombre `Carla Cajera`, correo `cajera@farmaxia.local`, contraseña temporal `Cajera12345`, rol **Cajero**, sucursal Casa Matriz → «Crear usuario».
  **Esperado:** «Usuario Carla Cajera creado. Ya puede iniciar sesión con su correo.»
- [ ] **M1-18 Crear un almacenero y un regente.** Igual que antes: `almacen@farmaxia.local` / `Almacen12345` (rol **Almacenero**) y `regente@farmaxia.local` / `Regente12345` (rol **Regente farmacéutico**).
  **Esperado:** ambos creados.
- [ ] **M1-19 Correo repetido.** Intenta crear otro usuario con `cajera@farmaxia.local`.
  **Esperado:** «Ya existe una cuenta con ese correo.»
- [ ] **M1-20 Contraseña débil.** Contraseña temporal `abc`.
  **Esperado:** rechazo (mínimo 10 caracteres, con letras y números).
- [ ] **M1-21 Menú según rol.** Entra como `cajera@farmaxia.local`.
  **Esperado:** solo ve **Resumen, Ventas POS, Clientes, Caja y turnos, Turnos y comisiones, Mi cuenta**. No ve Catálogo, Inventario, Compras, Usuarios, etc.
- [ ] **M1-22 Acceso directo bloqueado.** Con la cajera, escribe en la barra http://localhost:3000/catalog.
  **Esperado:** «Acceso restringido» y el enlace «Volver al resumen».
- [ ] **M1-23 Menú del almacenero.** Entra como `almacen@farmaxia.local`.
  **Esperado:** ve Resumen, Inventario, Compras, Traspasos, Turnos y comisiones, Mi cuenta. **No** ve Ventas POS ni Caja.
- [ ] **M1-24 Menú del regente.** Entra como `regente@farmaxia.local`.
  **Esperado:** ve Ventas, Catálogo, Inventario, Controlados, Auditoría, Analítica… pero **no** «Caja y turnos» ni «Usuarios y roles».
- [ ] **M1-25 Roles predefinidos.** Como admin, en la pestaña de roles, pulsa «Ver permisos» en «Cajero».
  **Esperado:** se ven sus permisos, pero **no** se puede modificar («Los roles predefinidos no se pueden modificar. Crea un rol personalizado.»).
- [ ] **M1-26 Rol personalizado.** «+ Nuevo rol»: nombre `Vendedor senior`, marca los permisos de ventas y de anular ventas → guardar.
  **Esperado:** el rol aparece en la lista.
- [ ] **M1-27 Rol en uso.** Asigna `Vendedor senior` a la cajera e intenta **eliminar** el rol.
  **Esperado:** «Quita este rol a sus usuarios antes de eliminarlo.» Quítaselo y elimínalo: ahora sí se borra.
- [ ] **M1-28 No tocarse a sí mismo.** Como admin, intenta desactivarte o cambiar tus propios roles.
  **Esperado:** «No puedes desactivarte ni cambiar tus propios roles.»
- [ ] **M1-29 Restablecer contraseña.** En la fila del almacenero, pulsa «Contraseña» y pon una nueva.
  **Esperado:** se guarda; el almacenero entra con la nueva.
- [ ] **M1-30 Desactivar usuario.** Desactiva al almacenero.
  **Esperado:** «… fue desactivado.» Ya no puede iniciar sesión. **Reactívalo** después (lo usarás en otros módulos).

### Auditoría

- [ ] **M1-31 Bitácora.** Ve a «Auditoría».
  **Esperado:** aparecen los eventos que generaste (usuarios creados, roles, cambio de contraseña…). Pulsa «Ver detalle» en uno.
- [ ] **M1-32 Filtros.** Usa «Acción», «Desde», «Hasta» y «Filtrar»; prueba «Siguiente →».
  **Esperado:** la lista se filtra y pagina.

---

## M2. Catálogo

**Qué hace:** registra los productos (medicamentos) con sus datos sanitarios, sus **presentaciones** (caja, unidad…), sus **códigos de barras** y sus **precios**.

**Dónde:** «Catálogo» (`/catalog`, `/catalog/products/new`, `/catalog/products/[id]`, `/catalog/categories`). Usuario: admin.

> En este módulo vas a crear el producto **Ibuprofeno 400mg** que luego comprarás y venderás, y el producto controlado **Diazepam 10mg** para el módulo M8.

### Categorías

- [ ] **M2-01 Crear categoría normal.** «Categorías» → «Nueva categoría»: `Analgésicos` → «Crear categoría».
  **Esperado:** aparece en la lista.
- [ ] **M2-02 Crear categoría controlada.** Nombre `Psicotrópicos`, marca «Categoría de medicamentos controlados».
  **Esperado:** aparece marcada como controlada.
- [ ] **M2-03 Renombrar y desactivar.** Renombra `Analgésicos` a `Analgésicos y antiinflamatorios`. Desactívala y reactívala.
  **Esperado:** los cambios se reflejan.

### Productos

- [ ] **M2-04 Validación de nombre.** «+ Nuevo producto», deja vacío el nombre comercial y pulsa «Crear producto».
  **Esperado:** «El nombre comercial es obligatorio (hasta 200 caracteres).»
- [ ] **M2-05 Validación de códigos SIN.** Escribe letras en «Código de producto SIN».
  **Esperado:** «Los códigos del SIN solo llevan números.»
- [ ] **M2-06 Crear Ibuprofeno.** Nombre comercial `Ibuprofeno 400mg`, genérico `Ibuprofeno`, principio activo `Ibuprofeno`, forma `Tableta`, laboratorio `Lab Bago`, categoría `Analgésicos y antiinflamatorios`, clasificación «Venta libre» → «Crear producto».
  **Esperado:** «Producto creado. Ahora agrega sus presentaciones…»
- [ ] **M2-07 Presentaciones.** En la ficha, «Nueva presentación»: `Caja x 10`, factor `10`, marcada «Se vende en esta presentación» → «Agregar presentación». Agrega también `Unidad`, factor `1`.
  **Esperado:** ambas aparecen.
- [ ] **M2-08 Factor no editable.** Intenta cambiar el factor de `Caja x 10`.
  **Esperado:** no se puede («El factor de conversión no se puede cambiar. Crea una presentación nueva y desactiva esta.»).
- [ ] **M2-09 Solo compra.** En `Unidad`, cambia a «Solo compra» y luego de vuelta a «Ahora se vende en esta presentación».
  **Esperado:** el estado cambia.
- [ ] **M2-10 Código de barras.** En `Caja x 10`, «Agregar código»: `7779999000011`.
  **Esperado:** el código queda asociado.
- [ ] **M2-11 Cadena de frío (validación).** Crea el producto `Insulina NPH`, marca «Requiere cadena de frío» y pon temperatura mínima `-50`.
  **Esperado:** «La temperatura debe estar entre -40 y 40 °C, con un decimal como máximo.» Corrige a `2` y `8` y créalo. Agrégale la presentación `Frasco`, factor `1`.
- [ ] **M2-12 Crear Diazepam (controlado).** Nombre `Diazepam 10mg`, categoría `Psicotrópicos`, clasificación «Controlado», marca «Medicamento controlado». Presentación `Caja x 30`, factor `30`.
  **Esperado:** en la lista aparece con la insignia **Controlado**.
- [ ] **M2-13 Editar ficha.** En Ibuprofeno, cambia el laboratorio y pulsa «Guardar ficha».
  **Esperado:** «Ficha actualizada. El cambio quedó registrado en Auditoría.» (Compruébalo en Auditoría.)
- [ ] **M2-14 Desactivar producto.** Desactiva `Insulina NPH`.
  **Esperado:** pide confirmación («¿Desactivar…? No aparecerá en ventas ni compras; su historial se conserva.»). Desaparece de la lista salvo que marques «Mostrar desactivados». Reactívalo.
- [ ] **M2-15 Marcar categoría controlada.** En Categorías, crea `Prueba controlada`, asígnale la Insulina y pulsa «Marcar controlada».
  **Esperado:** pide confirmar que N productos quedarán como controlados; luego la Insulina sale como Controlado. *(Después devuelve la Insulina a otra categoría si no la quieres controlada.)*

### Búsqueda y filtros

- [ ] **M2-16 Buscar.** En `/catalog` busca `ibu`, luego `Bago`, luego `7771234567890`.
  **Esperado:** encuentra el producto por nombre, laboratorio y código.
- [ ] **M2-17 Filtros.** Usa «Controlados», «Cadena de frío» y «Categoría».
  **Esperado:** la lista se filtra correctamente.

### Precios y códigos

- [ ] **M2-18 Precio de Ibuprofeno.** Panel «Precios y códigos de barras» → lista activa «Lista General», presentación `Ibuprofeno 400mg · Caja x 10`, monto `12.50`, válido desde hoy → «Registrar precio».
  **Esperado:** «Precio vigente registrado sin alterar el historial.»
- [ ] **M2-19 Precio de Unidad y Diazepam.** Registra `Unidad` de Ibuprofeno a `1.50` y `Diazepam · Caja x 30` a `45.00`.
  **Esperado:** registrados.
- [ ] **M2-20 Precio solapado.** ⚠️ Registra otro precio para `Caja x 10` con la misma fecha de inicio.
  **Esperado:** rechazo «Price interval overlaps an existing price in the same scope.» (sale en inglés).
- [ ] **M2-21 Nueva lista de precios.** «Nueva lista»: `Lista Sucursal`, moneda `BOB`, marca «Solo esta sucursal» → «Crear lista».
  **Esperado:** «Lista de precios creada para esta organización.»
- [ ] **M2-22 Buscar código de barras.** «Buscar código» con `7779999000011` y luego con `0000000000000`.
  **Esperado:** el primero muestra Ibuprofeno; el segundo «No encontramos un producto activo con ese código de barras.»

---

## M3. Inventario

**Qué hace:** controla el stock por **lote** y **vencimiento**, avisa de lo que está por vencer, permite poner lotes en cuarentena, dar de baja mermas (con acta), administrar almacenes y hacer conteos físicos.

**Dónde:** «Inventario» → «Vencimientos y alertas», «Almacenes», «Inventario físico», «Actas de baja», «Reservas»; y «Reporte global» (`/inventory/report`).

### Almacenes

- [ ] **M3-01 Crear almacén.** «Almacenes» → «Nuevo almacén»: `Depósito Secundario`, tipo general, marca «Despacha a ventas (FEFO)».
  **Esperado:** aparece en la lista. *(Lo usarás en Traspasos.)*
- [ ] **M3-02 Nombre repetido.** Crea otro `Depósito Secundario`.
  **Esperado:** «Ya existe un almacén con ese nombre en la sucursal.»
- [ ] **M3-03 Cuarentena que despacha.** Crea `Cuarentena`, tipo cuarentena, con «Despacha a ventas» marcado.
  **Esperado:** «Un almacén de cuarentena no puede despachar ventas.» Créalo sin despacho.
- [ ] **M3-04 Desactivar almacén con stock.** Intenta desactivar «Almacén Central».
  **Esperado:** «No se puede desactivar un almacén con stock o reservas…»

### Reporte global

- [ ] **M3-05 Ver stock.** Abre «Reporte global».
  **Esperado:** tarjetas «Físico», «Reservado», «Disponible». Paracetamol con **230** unidades en Almacén Central. **Anota este número**: lo usarás para verificar compras, ventas y mermas.
- [ ] **M3-06 Buscar.** Busca `Paracetamol`.
  **Esperado:** filtra la tabla.

### Vencimientos y alertas

- [ ] **M3-07 Lotes por vencer.** «Vencimientos y alertas», horizonte 30 días.
  **Esperado:** aparece `LOTE-2026-B` (vence en ~20 días). Con 7 días no aparece; con 90 sí.
- [ ] **M3-08 Alertas automáticas.** En el panel «Alertas automáticas», pulsa «Marcar revisada».
  **Esperado:** la alerta se marca como revisada.
- [ ] **M3-09 Cuarentena sin temperatura.** En `LOTE-2026-B` → «Cuarentenar lote», motivo «Cadena de frío», sin temperatura.
  **Esperado:** «Registra la temperatura para una incidencia de cadena de frío.»
- [ ] **M3-10 Cuarentena correcta.** Motivo «Calidad» → confirmar.
  **Esperado:** el lote pasa a cuarentena. En el **Reporte global** el disponible baja 30. En el **POS** el stock de Paracetamol baja a 200.
- [ ] **M3-11 Liberar lote.** «Liberar lote» en `LOTE-2026-B`.
  **Esperado:** vuelve a estar disponible.
- [ ] **M3-12 Merma.** En `LOTE-2026-A` → «Registrar merma»: cantidad `5`, destino destrucción, detalle `Cajas dañadas`.
  **Esperado:** se registra; en el Reporte global Paracetamol baja 5 (225). Se genera un acta.
- [ ] **M3-13 Merma mayor al stock.** ⚠️ Merma de `99999` en `LOTE-2026-B`.
  **Esperado:** debe rechazarse. *Puede salir «Internal server error» en vez de un mensaje claro: si pasa, anótalo como fallo.*

### Actas de baja

- [ ] **M3-14 Acta generada.** «Actas de baja».
  **Esperado:** aparece el acta `AB-SUC-001-000001`. Abre el detalle: título «ACTA DE BAJA DE PRODUCTOS FARMACÉUTICOS», con firmas. Pulsa «Imprimir acta» (se abre el diálogo de impresión; puedes guardar como PDF).

### Inventario físico (conteo ciego)

- [ ] **M3-15 Abrir conteo.** «Inventario físico» → «Abrir conteo» en Almacén Central.
  **Esperado:** se crea el conteo; al entrar **no** ves el stock del sistema («Anota lo que hay en el estante»).
- [ ] **M3-16 Conteo duplicado.** Intenta abrir otro conteo en el mismo almacén.
  **Esperado:** «Ya hay un conteo en curso para este almacén.»
- [ ] **M3-17 Contar con diferencia.** Pon en `LOTE-2026-A` 2 unidades menos de las que hay (si había 195, pon 193). «Guardar avance» → «Enviar a revisión».
  **Esperado:** pide confirmar; ya no se pueden cambiar cantidades.
- [ ] **M3-18 Aprobar.** «Aprobar y ajustar».
  **Esperado:** el inventario se ajusta; el Reporte global refleja la diferencia.
- [ ] **M3-19 Sin permiso de aprobar.** Abre otro conteo y entra como almacenero.
  **Esperado:** puede contar y enviar, pero **no** ve «Aprobar y ajustar». (Anula ese conteo con el admin: «Anular conteo».)

### Reservas

- [ ] **M3-20 Pantalla de reservas.** «Reservas».
  **Esperado:** normalmente vacía (ver nota ⛔: el POS descuenta directo, no reserva).

---

## M4. Compras

**Qué hace:** gestiona proveedores, órdenes de compra, la **recepción por lotes** (que suma stock), las facturas y deudas con proveedores, los pagos y sugerencias de reposición.

**Dónde:** «Compras» → «Órdenes», «Recepción», «Facturas», «Pagos», «Reposición».

### Proveedores y órdenes

- [ ] **M4-01 Registrar proveedor.** «Registrar proveedor»: `Distribuidora Andina`, NIT `5544332211`.
  **Esperado:** aparece en el selector de proveedores.
- [ ] **M4-02 Orden sin proveedor.** Intenta «Crear orden» sin elegir proveedor ni almacén.
  **Esperado:** «Selecciona proveedor y almacén antes de crear la orden.»
- [ ] **M4-03 Producto repetido.** Agrega dos líneas con el mismo producto.
  **Esperado:** «Un producto no puede repetirse en la misma orden; suma las cantidades en una línea.»
- [ ] **M4-04 Crear orden.** Proveedor `Distribuidora Andina`, almacén `Almacén Central`. Líneas: `Ibuprofeno · Caja x 10` cantidad base `100`, costo `0.80`; `Diazepam · Caja x 30` cantidad base `60`, costo `1.20` → «Crear orden».
  **Esperado:** se ve el «Total estimado»; mensaje «Orden creada con 2 producto(s). Ya puedes registrar su recepción por lote.»

### Recepción

- [ ] **M4-05 Recepción parcial.** «Recepción» (o «Recibir lotes» en la orden). Ibuprofeno: lote `IBU-001`, vence dentro de 1 año, cantidad `60`, costo `0.80` → «Registrar recepción».
  **Esperado:** la orden queda en «Recepción parcial». En el Reporte global aparece Ibuprofeno con **60** unidades.
- [ ] **M4-06 Lote repetido.** En una misma recepción, agrega dos líneas `IBU-002` para la misma presentación.
  **Esperado:** «No repitas el mismo lote para una presentación dentro de la recepción.»
- [ ] **M4-07 Recibir de más.** ⚠️ Intenta recibir `500` de Ibuprofeno.
  **Esperado:** rechazo «Received quantity exceeds the purchase order.» (en inglés).
- [ ] **M4-08 Completar recepción.** Ibuprofeno lote `IBU-002`, cantidad `40`, vence en 6 meses. Diazepam lote `DZP-001`, cantidad `60`, vence en 2 años.
  **Esperado:** la orden pasa a recibida. Reporte global: Ibuprofeno **100**, Diazepam **60**.
- [ ] **M4-09 Cerrar saldo / cancelar.** Crea otra orden pequeña y pulsa «Cancelar orden» con motivo `ab`.
  **Esperado:** «Indica el motivo (entre 3 y 255 caracteres).» Con motivo `Error de pedido` se cancela.

### Facturas y pagos a proveedor

- [ ] **M4-10 Registrar factura.** «Facturas» → «Registrar cuenta»: proveedor `Distribuidora Andina`, la recepción de M4-05, número `F-1001`, emisión hoy, vencimiento en 15 días, total `48` → «Registrar factura».
  **Esperado:** aparece la factura.
- [ ] **M4-11 Agenda de pagos.** «Pagos».
  **Esperado:** la deuda aparece en el tramo correspondiente («Esta semana», «Próximos 30 días»…).
- [ ] **M4-12 Programar pago.** «Programar pago para» una fecha → «Guardar fecha»; luego «Quitar fecha».
  **Esperado:** la fecha se guarda y se quita.
- [ ] **M4-13 Pago parcial.** Monto `20`, método transferencia, referencia `TRX-1` → «Registrar pago».
  **Esperado:** estado «Pago parcial»; aparece en el historial de pagos.
- [ ] **M4-14 Pago de más.** Intenta pagar `1000`.
  **Esperado:** «El pago supera el saldo pendiente (…).»
- [ ] **M4-15 Pagar el resto.** Paga el saldo restante.
  **Esperado:** estado pagada. Otro pago: «La cuenta ya está pagada.»
- [ ] **M4-16 Sin permiso de pagos.** Entra como regente e intenta registrar un pago.
  **Esperado:** «Para registrar pagos necesitas el permiso «Registrar pagos a proveedores».»

### Reposición

- [ ] **M4-17 Sugerencias.** «Reposición», cubrir 30 días.
  **Esperado:** muestra sugerencias según ventas recientes, o «No hace falta reponer nada.» (Repítelo después de vender en M6.)
- [ ] **M4-18 Días fuera de rango.** Pon `200` días.
  **Esperado:** «Los días de cobertura deben estar entre 7 y 120.»
- [ ] **M4-19 Orden desde sugerencias.** Si hay sugerencias: elige proveedor y almacén, marca productos → «Crear orden con lo marcado».
  **Esperado:** se crea la orden en «Órdenes».

---

## M5. Caja y turnos

**Qué hace:** controla el efectivo. Se **programa** un turno en una caja, una persona asignada lo **abre** con un fondo inicial, durante el turno se registran ingresos/egresos y al final se **cuenta** el efectivo. Si hay diferencia, un supervisor la aprueba.

**Dónde:** «Caja y turnos» (`/cash`).

- [ ] **M5-01 Turno del seed.** Abre «Caja y turnos».
  **Esperado:** hay un turno **abierto** en CAJA-01 con «Fondo inicial» Bs 100.
- [ ] **M5-02 Movimientos: validaciones.** En «Movimientos de caja», registra un egreso sin motivo, y otro con monto `0`.
  **Esperado:** «El motivo es obligatorio y admite hasta 200 caracteres.» / «El monto debe ser mayor a cero, con hasta 4 decimales.»
- [ ] **M5-03 Ingreso.** Tipo Ingreso, `50`, categoría «Fondo de cambio», motivo `Cambio adicional` → «Registrar movimiento».
  **Esperado:** «Ingresos» sube 50 y «Efectivo esperado» pasa a 150.
- [ ] **M5-04 Egreso.** Tipo Egreso, `20`, motivo `Compra de bolsas`.
  **Esperado:** «Efectivo esperado» baja a 130.
- [ ] **M5-05 Egreso mayor al efectivo.** ⚠️ Egreso de `100000`.
  **Esperado:** rechazo «The withdrawal cannot exceed the expected cash of the shift.» (en inglés).
- [ ] **M5-06 Programar turno: validación.** «Programar turno» con fin anterior al inicio.
  **Esperado:** «El fin del turno debe ser posterior al inicio.»
- [ ] **M5-07 Turno solapado.** ⚠️ Programa un turno en CAJA-01 que se cruce con el actual.
  **Esperado:** «The cash register already has a shift in that interval.» (en inglés).
- [ ] **M5-08 Programar turno para la cajera.** Programa un turno en CAJA-01 que empiece **justo cuando termina** el turno actual, asignado a `Carla Cajera`.
  **Esperado:** se crea en estado «Sin abrir».
- [ ] **M5-09 Abrir turno ajeno.** Como admin, intenta abrir el turno de la cajera.
  **Esperado:** «Solo una persona asignada puede abrir este turno.»

> **Deja el turno del seed abierto** hasta terminar el módulo M6 (lo necesitas para vender). Las pruebas de cierre están en **M6-30 a M6-33**.

---

## M6. Ventas POS, historial, devoluciones y proformas

**Qué hace:** el punto de venta. Busca productos, arma el carrito, descuenta stock por **FEFO** (primero vence, primero sale), cobra con varios medios, pide receta si hay controlados, emite recibo, y permite anular, devolver y hacer proformas (cotizaciones).

**Dónde:** «Ventas POS» → «Nueva venta» (`/sales`), «Historial» (`/sales/history`), «Proformas» (`/sales/quotes`).

### Venta básica

- [ ] **M6-01 Pantalla lista.** Abre «Nueva venta».
  **Esperado:** «Turno abierto» y «Almacén de despacho» ya elegidos (Almacén Central).
- [ ] **M6-02 Buscar por nombre.** Busca `parace`.
  **Esperado:** aparece Paracetamol con precio y «Stock: N».
- [ ] **M6-03 Buscar por código.** Escribe `7771234567890` y Enter.
  **Esperado:** se agrega directo al carrito.
- [ ] **M6-04 Código inexistente.** Escribe `1234567890123` y Enter.
  **Esperado:** «El código de barras 1234567890123 no está registrado.»
- [ ] **M6-05 Sin resultados.** Busca `zzzz`.
  **Esperado:** `No encontramos productos para "zzzz".`
- [ ] **M6-06 Atajos de teclado.** Prueba F2 (buscar), flechas + Enter (elegir), F4 (cobro), Esc (limpiar).
  **Esperado:** cada atajo hace lo indicado.
- [ ] **M6-07 FEFO.** Agrega 1 Paracetamol al carrito.
  **Esperado:** el lote sugerido es **LOTE-2026-B** (el que vence primero).
- [ ] **M6-08 Cobro insuficiente.** Pago en efectivo menor al total → «Confirmar venta (F9)».
  **Esperado:** «Los pagos no cubren el total de la venta.»
- [ ] **M6-09 Tarjeta sin referencia.** Cambia el pago a Tarjeta sin referencia.
  **Esperado:** «Los pagos con tarjeta o QR requieren una referencia.»
- [ ] **M6-10 Venta en efectivo con vuelto.** Efectivo `20` para un total de `15` → «Confirmar venta (F9)».
  **Esperado:** «Venta confirmada», «Cambio 5 BOB», «FEFO aplicado a 1 línea(s)», número `V-SUC-001-000001` (o el siguiente). Pulsa «Siguiente cliente».
- [ ] **M6-11 Efectos de la venta.** Revisa:
  - Reporte global: Paracetamol bajó **20** unidades (1 caja = 20).
  - Caja: «Ventas en efectivo» subió 15 y el «Efectivo esperado» también.
  - Resumen: «Ventas de hoy» y «Ventas recientes» muestran la venta.
  - Auditoría: aparece el evento de la venta.
- [ ] **M6-12 Pago mixto.** Vende 2 Ibuprofeno Caja x 10 (Bs 25): Bs 10 en efectivo + Bs 15 en QR con referencia `QR-555`.
  **Esperado:** venta confirmada con dos pagos.
- [ ] **M6-13 Tarjeta de más.** Total 15, tarjeta por 20.
  **Esperado:** «Los pagos con tarjeta, QR, puntos o convenio no pueden superar el monto por cobrar.»
- [ ] **M6-14 Stock insuficiente.** ⚠️ Intenta vender 50 cajas de Ibuprofeno.
  **Esperado:** rechazo «Insufficient available FEFO inventory for the sale line.» (en inglés).
- [ ] **M6-15 Lote en cuarentena no se vende.** Pon `LOTE-2026-B` en cuarentena (M3) y busca Paracetamol en el POS.
  **Esperado:** el stock mostrado no cuenta ese lote; el FEFO sugiere `LOTE-2026-A`. Libéralo después.
- [ ] **M6-16 Cambiar de lote (FEFO manual).** En el carrito, «Cambiar lote» a `LOTE-2026-A` sin motivo.
  **Esperado:** «Escribe el motivo del cambio de lote (hasta 200 caracteres).» Con motivo `Cliente pide vencimiento largo` se acepta y se vende.
- [ ] **M6-17 Cajera no cambia lote.** Entra como cajera (necesita turno abierto propio, ver M6-30) y busca «Cambiar lote».
  **Esperado:** no aparece la opción.
- [ ] **M6-18 Cambiar de almacén.** Con algo en el carrito, cambia el almacén de despacho a `Depósito Secundario`.
  **Esperado:** «Cambiaste de almacén: el carrito se vació porque el stock es distinto.»
- [ ] **M6-19 Producto sin precio.** Busca `Insulina NPH` (no le pusiste precio).
  **Esperado:** aparece como «Sin precio» y no se puede vender.

### Historial y recibo

- [ ] **M6-20 Historial.** «Historial».
  **Esperado:** aparecen tus ventas. Prueba filtros «Desde», «Hasta», «Estado», «Turno», «Cajero».
- [ ] **M6-21 Recibo.** «Ver detalle» de una venta → «Ancho del papel» 58 mm y luego 80 mm → «Imprimir recibo».
  **Esperado:** recibo con lote y vencimiento por línea, «Documento no fiscal — no válido como factura» y «¡Gracias por su compra!». En la venta de M6-16 aparece «Lote elegido manualmente: …».
- [ ] **M6-22 Comprobante fiscal.** En el detalle, panel «Comprobante fiscal».
  **Esperado:** «pendiente (SIAT no conectado)».
- [ ] **M6-23 Historial de la cajera.** Como cajera, abre «Historial».
  **Esperado:** solo ve **sus** ventas.

### Anulación y devolución

- [ ] **M6-24 Anular sin motivo.** En el detalle de una venta, «Anular venta» sin motivo.
  **Esperado:** «El motivo es obligatorio y admite hasta 200 caracteres.»
- [ ] **M6-25 Anular venta.** Motivo `Venta de prueba` → confirmar.
  **Esperado:** estado anulada. El stock vuelve a los lotes originales y el efectivo esperado de la caja baja.
- [ ] **M6-26 Devolución parcial.** En la venta de Ibuprofeno (2 cajas), «Registrar devolución»: cantidad `1`, método Efectivo, motivo `No le sirvió`, marca «Devolver las unidades al stock».
  **Esperado:** «Devolución D-SUC-001-000001 registrada. Reembolso: Bs 12.50.» Estado «devuelta parcial». Stock +10, efectivo esperado −12.50.
- [ ] **M6-27 Devolver de más.** Intenta devolver `5` de una línea que tiene 1 pendiente.
  **Esperado:** «La cantidad de «…» debe ser un entero entre 1 y N.»
- [ ] **M6-28 Devolución dañada.** Devuelve la caja restante **desmarcando** «Devolver las unidades al stock».
  **Esperado:** estado «devuelta»; el stock **no** sube.
- [ ] **M6-29 Reembolso con tarjeta sin referencia.** En otra venta, método Tarjeta sin referencia.
  **Esperado:** «Tarjeta y QR requieren una referencia del reembolso.»

### Cierre de caja (continúa M5)

- [ ] **M6-30 Contar con diferencia.** En «Caja y turnos», turno abierto, mira el «Efectivo esperado» y en «Conteo final (BOB)» pon **Bs 5 menos** → «Guardar conteo».
  **Esperado:** el turno queda «Pendiente de aprobación».
- [ ] **M6-31 Aprobar diferencia.** Pulsa «Aprobar y cerrar» con una nota.
  **Esperado:** «Diferencia aprobada y turno cerrado.»
- [ ] **M6-32 Sin turno no se vende.** Ve a «Nueva venta».
  **Esperado:** «Espacio de ventas incompleto» pidiendo «un turno abierto».
- [ ] **M6-33 Turno de la cajera.** Entra como cajera cuando haya empezado su turno (M5-08), abre con monto inicial `-5`.
  **Esperado:** «El monto inicial debe ser un decimal no negativo con hasta 4 decimales.» Abre con `50`, haz una venta y cuenta el **monto exacto**.
  **Esperado:** el turno se **cierra solo** (sin aprobación).

> Para seguir vendiendo como admin, programa un turno nuevo para el admin y ábrelo.

### Proformas

- [ ] **M6-34 Vigencia inválida.** «Proformas» → «Nueva proforma», vigencia `40` días.
  **Esperado:** «La vigencia debe ser un número entero de días entre 1 y 30.»
- [ ] **M6-35 Crear proforma.** Cliente `Juan Pérez`, vigencia `7`, 2 Paracetamol, nota `Precio sujeto a stock` → «Crear proforma».
  **Esperado:** número `P-SUC-001-000001`, estado abierta. El stock **no** cambia.
- [ ] **M6-36 Imprimir proforma.** «Imprimir proforma» en 58 mm, 80 mm y A4.
  **Esperado:** se abre el diálogo de impresión.
- [ ] **M6-37 Convertir en venta.** «Convertir en venta».
  **Esperado:** abre el POS con el carrito cargado. Cobra y confirma; la proforma pasa a convertida.
- [ ] **M6-38 Precio cambiado.** Crea otra proforma, cambia el precio del producto en Catálogo (con fecha nueva) y conviértela.
  **Esperado:** «Los precios cambiaron desde la proforma: revisa el total antes de cobrar.»
- [ ] **M6-39 Anular proforma.** En otra proforma, «Anular proforma».
  **Esperado:** pide confirmar; estado anulada.

---

## M7. Traspasos

**Qué hace:** mueve mercadería entre almacenes (o sucursales) con trazabilidad: solicitud → aprobación (plan Premium) → despacho (sale del origen, queda «en tránsito») → recepción en destino.

**Dónde:** «Traspasos» (`/transfers`, `/transfers/[id]`). Requiere el almacén `Depósito Secundario` de M3-01.

- [ ] **M7-01 Mismo origen y destino.** «Solicitar movimiento» con origen y destino `Almacén Central`.
  **Esperado:** «El almacén de origen y el de destino deben ser distintos.»
- [ ] **M7-02 Cantidad mayor al stock.** Origen `Almacén Central`, destino `Depósito Secundario`, lote `IBU-001`, cantidad `9999`.
  **Esperado:** «La cantidad solicitada supera el stock disponible (N).»
- [ ] **M7-03 Lote repetido.** Agrega dos ítems con el mismo lote.
  **Esperado:** «Un mismo lote no puede repetirse en el traspaso.»
- [ ] **M7-04 Solicitar traspaso.** `IBU-001`, cantidad `20` → «Solicitar traspaso».
  **Esperado:** estado «Solicitado».
- [ ] **M7-05 Rechazar.** Solicita otro traspaso y pulsa «Rechazar» con motivo `ab`.
  **Esperado:** pide motivo de 3 a 255 caracteres. Con motivo válido: «Traspaso rechazado.»
- [ ] **M7-06 Aprobar.** En el de M7-04: «Aprobar».
  **Esperado:** «Traspaso aprobado.» (En plan Profesional este paso no existe: se despacha directo.)
- [ ] **M7-07 Despachar.** «Despachar».
  **Esperado:** «Traspaso despachado.» En el Reporte global, Almacén Central baja 20 de Ibuprofeno.
- [ ] **M7-08 Recibir de más.** Cantidad recibida `25`.
  **Esperado:** «La cantidad recibida excede lo pendiente para el ítem …»
- [ ] **M7-09 Recepción parcial.** Recibe `15` con motivo de diferencia `Faltaron 5`.
  **Esperado:** estado «Recepción parcial». Depósito Secundario tiene 15.
- [ ] **M7-10 Completar.** Recibe los `5` restantes.
  **Esperado:** estado «Recibido». Depósito Secundario tiene 20.
- [ ] **M7-11 Vender desde el otro almacén.** En el POS, almacén de despacho `Depósito Secundario`, vende 1 caja de Ibuprofeno.
  **Esperado:** se vende desde ese almacén.
- [ ] **M7-12 Desde cuarentena.** Intenta un traspaso con origen el almacén `Cuarentena`.
  **Esperado:** «No se puede despachar traspasos desde un almacén de cuarentena.» (o el almacén no tiene lotes para elegir).

---

## M8. Medicamentos controlados

**Qué hace:** obliga a registrar la **receta** al vender un controlado, archiva las recetas (inmutables), y en plan Premium lleva el **libro de controlados** y los **saldos mensuales**.

**Dónde:** POS (al vender) y «Controlados» → «Recetas archivadas», «Saldos mensuales», «Libro de controlados».

- [ ] **M8-01 Aviso en el carrito.** En el POS agrega `Diazepam 10mg`.
  **Esperado:** insignia «Controlado» y aviso «El carrito tiene medicamentos controlados: al confirmar te pediremos los datos de la receta.»
- [ ] **M8-02 Pedido de receta.** Cobra y pulsa «Confirmar venta (F9)».
  **Esperado:** se abre el diálogo «Datos de la receta».
- [ ] **M8-03 Campos obligatorios.** Deja todo vacío y pulsa «Registrar receta y confirmar venta».
  **Esperado:** «El nombre del médico es obligatorio.», «La matrícula del médico es obligatoria.», etc.
- [ ] **M8-04 Matrícula inválida.** Matrícula `A`.
  **Esperado:** «La matrícula debe tener entre 3 y 20 letras, números o guiones.»
- [ ] **M8-05 Receta futura.** Fecha de mañana.
  **Esperado:** «La fecha de la receta no puede ser futura.»
- [ ] **M8-06 Receta vieja.** Fecha de hace 40 días.
  **Esperado:** «La receta tiene más de 30 días y ya no es válida.»
- [ ] **M8-07 Venta con receta.** Médico `Dr. Luis Rojas`, matrícula `MAT-1234`, paciente `Ana Flores`, CI `1234567`, centro `Hospital Obrero`, fecha de hoy → confirmar.
  **Esperado:** venta confirmada con folio de receta `R-SUC-001-000001`.
- [ ] **M8-08 Recetas archivadas.** «Controlados» → lista.
  **Esperado:** aparece la receta. Busca por `Ana`, por `MAT-1234` y por folio.
- [ ] **M8-09 Fechas invertidas.** «Desde» posterior a «Hasta».
  **Esperado:** «La fecha inicial no puede ser posterior a la final.»
- [ ] **M8-10 Detalle inmutable.** «Ver detalle».
  **Esperado:** «Datos archivados al momento de la venta; no se pueden modificar.», con productos y lotes.
- [ ] **M8-11 Saldos mensuales.** «Saldos mensuales», mes actual.
  **Esperado:** Diazepam con saldo inicial, entradas (60 de la compra), salidas (lo vendido), saldo final = stock actual.
- [ ] **M8-12 Libro de controlados.** «Libro de controlados», mes actual.
  **Esperado:** movimientos cronológicos con folio y receta. Prueba «Imprimir» y «Descargar CSV».
- [ ] **M8-13 Regente puede exportar, encargado no.** Como regente, el botón «Descargar CSV» está disponible.
  **Esperado:** sí. (Solo Propietario y Regente pueden exportar.)
- [ ] **M8-14 Cajera no ve controlados.** Como cajera, abre http://localhost:3000/controlled.
  **Esperado:** «Acceso restringido».

---

## M9. Personal: turnos, comisiones y productividad

**Qué hace:** programa turnos de trabajo y guardias (distintos de los turnos de caja), registra entrada/salida, calcula comisiones por venta y muestra la productividad de cada vendedor.

**Dónde:** «Turnos y comisiones» → «Turnos» (`/staff`), «Comisiones», «Productividad».

### Turnos de trabajo

- [ ] **M9-01 Programar turno.** «Rol semanal» → «Programar turno»: persona `Carla Cajera`, tipo turno normal, inicio dentro de 10 minutos, fin en 8 horas.
  **Esperado:** aparece en el rol semanal.
- [ ] **M9-02 Turno cruzado.** Programa otro turno a la cajera que se cruce.
  **Esperado:** «La persona ya tiene un turno que se cruza con ese horario.»
- [ ] **M9-03 Navegar semanas.** «← Anterior», «Esta semana», «Siguiente →».
  **Esperado:** cambia la semana.
- [ ] **M9-04 Marcar entrada.** Como cajera, en «Mis turnos» pulsa «Marcar entrada».
  **Esperado:** se registra. Si el turno empieza en más de 30 min: «Solo puedes registrar entrada desde 30 minutos antes del inicio y hasta el fin del turno.»
- [ ] **M9-05 Entrada repetida.** Pulsa de nuevo «Marcar entrada».
  **Esperado:** «Ya registraste tu entrada en este turno.»
- [ ] **M9-06 Marcar salida.** «Marcar salida».
  **Esperado:** se registra.
- [ ] **M9-07 Cancelar turno.** Como admin, programa otro turno y cancélalo sin motivo.
  **Esperado:** «Indica el motivo de la cancelación.» Con motivo, se cancela. Un turno con entrada marcada: «El turno ya tiene registro de entrada y no se puede cancelar.»

### Comisiones

- [ ] **M9-08 Sin reglas.** «Comisiones».
  **Esperado:** aviso «Aún no hay reglas: sin una regla general las ventas no generan comisión.»
- [ ] **M9-09 Regla general.** «Reglas de comisión», alcance general, tasa `2` % → «Crear regla».
  **Esperado:** creada. Otra regla general: «Ya existe una regla para ese alcance.»
- [ ] **M9-10 Regla por producto.** Alcance producto `Ibuprofeno`, tasa `5` %.
  **Esperado:** creada; en ventas de Ibuprofeno se usa 5 % (el producto gana a la general).
- [ ] **M9-11 Niveles por ventas.** «Niveles por ventas»: desde Bs `1000`, tasa `3` %.
  **Esperado:** creado. Otro con el mismo monto: «Ya existe un nivel con ese monto mínimo.»
- [ ] **M9-12 Mis comisiones.** Haz una venta y abre «Mis comisiones».
  **Esperado:** aparece la venta con neto, tasa y comisión. Las ventas anuladas no comisionan.

### Productividad

- [ ] **M9-13 Productividad.** «Productividad», período del mes.
  **Esperado:** por vendedor: ventas, venta neta, unidades, ticket promedio, devoluciones, anulaciones, horas trabajadas y venta por hora.

---

## M10. Clientes, puntos y convenios

**Qué hace:** registra clientes, les da **puntos de fidelización** por sus compras, y maneja **convenios** (empresas/seguros que pagan parte de la compra de sus afiliados) con estados de cuenta mensuales.

**Dónde:** «Clientes» → «Clientes», «Puntos», «Convenios», «Estados de cuenta».

### Clientes

- [ ] **M10-01 Registrar cliente.** Nombre `María López`, tipo CI, número `7654321`, teléfono `70000000` → «Registrar cliente».
  **Esperado:** aparece en la lista.
- [ ] **M10-02 Documento repetido.** Otro cliente con CI `7654321`.
  **Esperado:** «Ya existe un cliente con ese documento.»
- [ ] **M10-03 Editar.** Cambia el teléfono.
  **Esperado:** «Cliente actualizado.»
- [ ] **M10-04 Inactivar.** Desmarca «Cliente activo» y filtra por «Inactivos».
  **Esperado:** aparece en inactivos. **Reactívalo.**

### Puntos

- [ ] **M10-05 Configurar programa.** «Puntos»: activa «Programa de puntos activo», `10` Bs por punto, valor del punto `0.10` → «Guardar configuración».
  **Esperado:** guardado («Aplica a las próximas ventas.»). Con `0`: «Escribe montos mayores a cero con hasta 4 decimales.»
- [ ] **M10-06 Ganar puntos.** En el POS elige el cliente `María López` y vende Bs 50 en efectivo.
  **Esperado:** la venta muestra puntos ganados (5). En la ficha del cliente, el saldo es 5.
- [ ] **M10-07 Ajuste manual.** En la ficha, «Ajuste de puntos» `0`.
  **Esperado:** «Escribe los puntos como un entero distinto de cero (negativo para descontar).» Con `20` y motivo `Promoción` se suma.
- [ ] **M10-08 Saldo negativo.** Ajuste `-1000`.
  **Esperado:** «El ajuste dejaría el saldo de puntos en negativo.»
- [ ] **M10-09 Pagar con puntos sin cliente.** En el POS, pago «Puntos» sin cliente.
  **Esperado:** «Elige un cliente para pagar con puntos o con convenio.»
- [ ] **M10-10 Canje de puntos.** Con María elegida, paga Bs 2 con «Puntos» (= 20 puntos) y el resto en efectivo.
  **Esperado:** venta confirmada; el saldo baja.
- [ ] **M10-11 Puntos insuficientes.** Intenta pagar más puntos de los que tiene.
  **Esperado:** «El cliente no tiene puntos suficientes para ese canje.»
- [ ] **M10-12 Programa desactivado.** Desactiva el programa e intenta pagar con puntos.
  **Esperado:** «El programa de puntos está desactivado en esta farmacia.» Reactívalo.
- [ ] **M10-13 Reversión.** Anula la venta de M10-06.
  **Esperado:** los puntos ganados se revierten.

### Convenios

- [ ] **M10-14 Crear convenio.** «Convenios» → «Crear convenio»: `Seguro Universitario`, entidad pagadora `Universidad Mayor`, cobertura `50` %, crédito mensual `200` Bs, activo.
  **Esperado:** creado. Con el mismo nombre: «Ya existe un convenio con ese nombre.»
- [ ] **M10-15 Afiliar cliente.** «Afiliar cliente» → María, código `AF-001`.
  **Esperado:** afiliada. De nuevo: «El cliente ya está afiliado a este convenio.»
- [ ] **M10-16 Venta con convenio.** En el POS, cliente María, venta de Bs 40: pago «Convenio» Bs 20 + efectivo Bs 20.
  **Esperado:** venta confirmada; el convenio cubrió 20.
- [ ] **M10-17 Cobertura excedida.** Venta de Bs 40, convenio Bs 30.
  **Esperado:** «El monto del convenio supera lo que cubre de esta venta (máximo Bs 20).»
- [ ] **M10-18 Crédito excedido.** Baja el límite del afiliado a `10` y paga 20 con convenio.
  **Esperado:** «El monto supera el crédito mensual disponible del afiliado (Bs …).»
- [ ] **M10-19 Cliente no afiliado.** Con otro cliente, paga con convenio.
  **Esperado:** «El cliente no es un afiliado activo de ese convenio.»

### Estados de cuenta

- [ ] **M10-20 Ver cargos.** «Estados de cuenta» → «Nuevo estado de cuenta», convenio `Seguro Universitario`, mes actual → «Ver cargos del mes».
  **Esperado:** aparece el cargo de M10-16.
- [ ] **M10-21 Emitir.** «Emitir estado de cuenta».
  **Esperado:** emitido. Otro igual: «Ya existe un estado de cuenta de este convenio para el periodo.»
- [ ] **M10-22 Venta facturada no se anula.** Intenta anular la venta de M10-16.
  **Esperado:** «El cargo del convenio de esta venta ya está en un estado de cuenta emitido: no se puede anular ni devolver.»
- [ ] **M10-23 Imprimir y CSV.** En el detalle: «Imprimir» y «Descargar CSV».
  **Esperado:** funcionan; dice «Documento no fiscal — no válido como factura.»
- [ ] **M10-24 Pago del convenio.** «Registrar pago» por más del saldo.
  **Esperado:** «El pago supera el saldo pendiente del estado de cuenta.» Con el monto exacto: «Pago registrado: el estado de cuenta quedó pagado.»

---

## M11. Analítica

**Qué hace:** reportes de gestión: ventas, productos más vendidos, clasificación ABC, rotación, rentabilidad, quiebres de stock y pronóstico.

**Dónde:** «Analítica» → «Panel», «ABC», «Rotación», «Rentabilidad», «Quiebres». *(Hazlo al final, cuando ya haya ventas.)*

- [ ] **M11-01 Panel.** Período del mes.
  **Esperado:** «Venta neta» (sin anuladas, restando devoluciones), «Unidades vendidas», «Por vencer (30 días)», margen y «Productos más vendidos».
- [ ] **M11-02 Período inválido.** «Desde» posterior a «Hasta».
  **Esperado:** «Indica un período válido.»
- [ ] **M11-03 Pronóstico.** Panel «Pronóstico de demanda».
  **Esperado:** pronóstico o «Aún no hay historial suficiente.»
- [ ] **M11-04 ABC.** «ABC».
  **Esperado:** productos clasificados en A, B, C con porcentajes.
- [ ] **M11-05 Rotación.** «Rotación».
  **Esperado:** promedio diario, días de inventario, valor en stock, rotación.
- [ ] **M11-06 Rentabilidad.** «Agrupar por» producto, laboratorio y sucursal; «Descargar CSV».
  **Esperado:** márgenes por grupo; CSV descargado.
- [ ] **M11-07 Quiebres.** «Quiebres».
  **Esperado:** «Agotados y poca cobertura» y «Alertas de stock» (prueba «Marcar revisada»).
- [ ] **M11-08 Sin ventas.** Pon un período del año pasado.
  **Esperado:** «Sin ventas en este período.»

---

## M12. Integraciones (API pública y webhooks)

**Qué hace:** permite que sistemas externos (tienda online, etc.) consulten productos y stock con una **clave de API**, y recibir avisos automáticos (**webhooks**) cuando pasan cosas.

**Dónde:** «Integraciones» (`/integrations`). Solo Propietario.

- [ ] **M12-01 Crear clave.** «Claves de API» → «Nueva clave» `Tienda en línea` → «Crear clave».
  **Esperado:** la clave se muestra **una sola vez**. Cópiala.
- [ ] **M12-02 Usar la clave.** En una terminal:
  ```bash
  curl -H "X-Api-Key: TU_CLAVE" http://localhost:3001/api/public/v1/products
  curl -H "X-Api-Key: TU_CLAVE" http://localhost:3001/api/public/v1/stock
  ```
  **Esperado:** devuelve JSON con productos y stock. *(Si la ruta exacta no responde, revisa la pestaña «Cómo usar».)*
- [ ] **M12-03 Clave inválida.** Repite con `X-Api-Key: invalida`.
  **Esperado:** error de autorización.
- [ ] **M12-04 Revocar.** «Revocar» la clave y repite M12-02.
  **Esperado:** ya no funciona.
- [ ] **M12-05 Crear webhook.** «Webhooks» → «+ Nuevo webhook», URL `http://ejemplo.com/hook`.
  **Esperado:** rechazo (solo HTTPS, salvo localhost). Con `https://webhook.site/...` (crea una URL gratis en webhook.site) y eventos de venta → guardar.
- [ ] **M12-06 Entrega.** Haz una venta y espera ~30 s. «Ver entregas».
  **Esperado:** aparece la entrega; en webhook.site llega el aviso con la firma `X-Farmaxia-Signature`.
- [ ] **M12-07 Rotar secreto / desactivar.** «Rotar secreto» (se muestra una vez) y desactivar/reactivar.
  **Esperado:** funcionan.
- [ ] **M12-08 Pestaña «Cómo usar».**
  **Esperado:** explica `X-Api-Key`, límite de 120 solicitudes/minuto y la firma de webhooks.

---

## M13. Suscripción y planes (lado farmacia)

**Qué hace:** cada farmacia paga una suscripción mensual (Básico, Profesional o Premium). Según el plan, se habilitan o bloquean funciones y hay límites de usuarios. El pago se hace por QR o transferencia y FARMAXIA lo aprueba.

**Dónde:** `/register`, «Suscripción» (`/billing`). Como la farmacia del seed tiene plan COMPLETO (sin costo, sin límites), **aquí crearás una farmacia nueva**.

| Plan | Precio | Sucursales / Cajas / Usuarios | Bitácora |
|---|---|---|---|
| Básico | Bs 150 | 1 / 1 / 2 | 7 días |
| Profesional | Bs 350 | 3 / 4 / 8 | 30 días |
| Premium | Bs 700 | ilimitado | todo |

### Registro de una farmacia nueva

- [ ] **M13-01 Validaciones.** Cierra sesión → «Regístrala y prueba 7 días gratis». Plan **Básico**. Prueba: NIT `ABC` / contraseñas distintas / contraseña `abc`.
  **Esperado:** «El NIT solo debe contener números.» / «Las contraseñas no coinciden.» / «La contraseña debe tener al menos 10 caracteres, con letras y números.»
- [ ] **M13-02 Correo existente.** Usa `admin@farmaxia.local`.
  **Esperado:** «Ya existe una cuenta con ese correo.»
- [ ] **M13-03 Registro correcto.** Farmacia `Farmacia Prueba`, razón social `Prueba S.R.L.`, NIT `123456789`, tu nombre, correo `basico@prueba.local`, contraseña `Basico12345` → «Crear farmacia y empezar la prueba».
  **Esperado:** «¡Bienvenido a FARMAXIA!», fin de prueba en 7 días y el identificador. Pulsa «Entrar a mi farmacia».

### Bloqueos por plan (Básico)

- [ ] **M13-04 Tarjeta del plan.** Mira la tarjeta inferior del menú lateral.
  **Esperado:** «Básico», «En prueba · 1 por pagar» y botón «Ver suscripción».
- [ ] **M13-05 Sub-menús bloqueados.** Abre Analítica, Clientes, Controlados, Turnos y comisiones.
  **Esperado:** opciones con etiqueta «· Profesional» / «· Premium». Al entrar: «Tu plan actual no incluye esta funcionalidad.» y «Ver planes y suscripción».
- [ ] **M13-06 Traspasos bloqueado.** Abre «Traspasos» e intenta solicitar uno.
  **Esperado:** «Tu plan no incluye esta funcionalidad.»
- [ ] **M13-07 Integraciones bloqueado.** Abre «Integraciones».
  **Esperado:** bloqueado (requiere Premium).
- [ ] **M13-08 Límite de usuarios.** Crea 1 usuario (ya son 2: tú + él). Intenta crear un tercero.
  **Esperado:** «Tu plan no permite más usuarios activos. Sube de plan o desactiva a alguien.»
- [ ] **M13-09 Farmacia vacía.** Ve a «Nueva venta».
  **Esperado:** «Espacio de ventas incompleto» (no hay turno). El catálogo está vacío.
- [ ] **M13-10 Aislamiento entre farmacias.** En esta farmacia busca `Paracetamol` en Catálogo y `María` en Clientes.
  **Esperado:** **no aparecen** (son de la otra farmacia).

### Pago de la suscripción

- [ ] **M13-11 Comprobante.** «Suscripción».
  **Esperado:** plan, estado «Prueba gratis hasta…», uso del plan (usuarios 2/2) y el comprobante **FX-000001**.
- [ ] **M13-12 Ver comprobante.** «Ver comprobante» → «Imprimir o guardar PDF».
  **Esperado:** se abre el diálogo de impresión.
- [ ] **M13-13 Pago inválido.** «Registrar pago» sin referencia / monto `-5` / adjunto mayor a 2 MB.
  **Esperado:** «Indica el número de transacción o referencia.» / «El monto debe ser positivo, con hasta 2 decimales.» / «El comprobante debe pesar como máximo 2 MB.»
- [ ] **M13-14 Enviar pago.** Medio QR, referencia `QR-0001`, monto `150`, fecha de hoy, adjunta una imagen → «Enviar pago a revisión».
  **Esperado:** «Pago del comprobante FX-… enviado. FARMAXIA lo revisará y activará tu periodo.» → sigue en **M14**.
- [ ] **M13-15 Retención de auditoría.** En «Auditoría».
  **Esperado:** aviso «Tu plan permite consultar los últimos 7 días…»

---

## M14. Panel del operador SaaS (/platform)

**Qué hace:** es el panel de **FARMAXIA como empresa**: ve todas las farmacias clientes, aprueba pagos, cambia planes, suspende o reactiva farmacias y ajusta precios.

**Dónde:** http://localhost:3000/platform/login con `owner@farmaxia.local` / `Owner12345!`.

- [ ] **M14-01 Login equivocado.** Entra con `admin@farmaxia.local`.
  **Esperado:** «Correo o contraseña incorrectos.»
- [ ] **M14-02 Login correcto.** Con la cuenta de operador → «Entrar al panel».
  **Esperado:** «Así va el negocio.» con tarjetas «Farmacias con suscripción», «Ingreso mensual recurrente», «Planes activos y en mora», «Pagos por revisar».
- [ ] **M14-03 Farmacias.** «Farmacias».
  **Esperado:** aparecen `Farmacia Central` y `Farmacia Prueba`. Prueba «Buscar» y «Estado».
- [ ] **M14-04 Rechazar pago sin nota.** «Pagos» → en el pago de M13-14, «Rechazar» sin nota.
  **Esperado:** «Escribe el motivo del rechazo: la farmacia lo verá.»
- [ ] **M14-05 Aprobar pago.** Pulsa «Ver comprobante adjunto» y luego «Aprobar pago».
  **Esperado:** «Pago de … aprobado: el comprobante FX-… quedó pagado.» Reintentarlo: «Este pago ya fue revisado.»
- [ ] **M14-06 Efecto en la farmacia.** Entra como `basico@prueba.local` → «Suscripción».
  **Esperado:** comprobante pagado; «Pagado hasta…»; la tarjeta lateral dice «· al día».
- [ ] **M14-07 Monto menor.** Desde la farmacia, envía otro pago con monto menor al comprobante (si hay otro pendiente) e intenta aprobarlo.
  **Esperado:** «El monto declarado es menor al del comprobante: no se puede aprobar.»
- [ ] **M14-08 Cambiar plan.** «Farmacias» → `Farmacia Prueba` → «Cambiar plan» a **Profesional**.
  **Esperado:** pide confirmar. En la farmacia ahora se desbloquean Traspasos, Puntos, Turnos, Comisiones, Rentabilidad. Convenios, ABC, Libro de controlados e Integraciones siguen bloqueados (Premium).
- [ ] **M14-09 Funcionalidad extra.** En «Funcionalidades extra», habilita `public_api` → «Habilitar».
  **Esperado:** «Funcionalidad habilitada como extra.» La farmacia ya puede usar Integraciones. Luego «Quitar».
- [ ] **M14-10 Suspender.** «Suspender» la farmacia.
  **Esperado:** pide confirmar. En la farmacia, cualquier pantalla lleva a `/billing?bloqueado=1` con «Tu suscripción no está activa, por eso los módulos están bloqueados…»
- [ ] **M14-11 Reactivar.** «Reactivar».
  **Esperado:** la farmacia vuelve a operar.
- [ ] **M14-12 Historial.** En el detalle de la farmacia, «Historial».
  **Esperado:** aparecen las acciones que hiciste (cambio de plan, suspensión, etc.).
- [ ] **M14-13 Ciclo de cobro.** En el Resumen, «Ejecutar ciclo de cobro».
  **Esperado:** «Ciclo ejecutado: N comprobante(s) emitido(s), N en mora, N suspendida(s).»
- [ ] **M14-14 Precio de plan.** «Planes» → precio `abc` → «Guardar».
  **Esperado:** «El precio debe ser un número con hasta 2 decimales.» Con `160` se guarda (aplica a comprobantes futuros). **Vuelve a ponerlo en 150.**
- [ ] **M14-15 Visible en registro.** Desmarca «Visible en el registro de farmacias» en Premium y abre `/register`.
  **Esperado:** Premium no aparece. Vuelve a marcarlo.
- [ ] **M14-16 Cancelar suscripción.** *(Opcional, es definitivo.)* Registra otra farmacia descartable y pulsa «Cancelar suscripción».
  **Esperado:** queda cancelada y sus comprobantes abiertos se anulan.
- [ ] **M14-17 Cerrar sesión.** «Cerrar sesión» en la tarjeta «Panel de operador».
  **Esperado:** vuelve al login de plataforma.

---

## M15. Pruebas transversales

- [ ] **M15-01 Modo oscuro.** Menú de usuario → «Modo oscuro» / «Modo claro». También el botón de tema en el login y en `/platform`.
  **Esperado:** cambia el tema y se recuerda al recargar.
- [ ] **M15-02 Buscador de módulos.** Barra superior «Buscar…», escribe `inv` y Enter.
  **Esperado:** abre Inventario.
- [ ] **M15-03 Menú en celular.** Achica la ventana (o F12 → vista móvil). «Abrir menú» / «Cerrar menú» / tecla Escape.
  **Esperado:** el menú se abre y cierra; no hay desplazamiento horizontal.
- [ ] **M15-04 Cerrar sesión.** Menú de usuario → «Cerrar sesión».
  **Esperado:** vuelve a `/`. Con «Atrás» del navegador no se recupera la sesión.
- [ ] **M15-05 Sesión larga.** Deja la sesión abierta más de 15 minutos y sigue usándola.
  **Esperado:** sigue funcionando (el token se renueva solo).
- [ ] **M15-06 Recargar página.** Recarga (F5) en cualquier módulo.
  **Esperado:** sigues en sesión y en la misma página.
- [ ] **M15-07 Trazabilidad completa.** Elige un lote (por ejemplo `IBU-001`) y verifica que su historia cuadra: recepción (M4) → traspaso (M7) → ventas (M6) → devoluciones.
  **Esperado:** el stock del Reporte global coincide con la suma de movimientos.
- [ ] **M15-08 Auditoría final.** Revisa «Auditoría» de Farmacia Central.
  **Esperado:** hay eventos de todos los módulos que probaste.

---

## Funcionalidades no implementadas

No las pruebes: no existen todavía (o están pendientes de decisión).

- ⛔ **Facturación electrónica SIAT** (factura real con CUF, QR, firma, contingencia, anulación). Solo existe el borrador «pendiente (SIAT no conectado)».
- ⛔ **Crear sucursales y cajas** desde la pantalla. Por eso no se puede probar cambiar de sucursal ni los límites de sucursales/cajas.
- ⛔ **Venta offline / app instalable (PWA).**
- ⛔ **Notificaciones por correo, SMS o push.** Solo existen la campana y las alertas en pantalla.
- ⛔ **Pasarela de pago real.** Tarjeta y QR se registran con referencia manual.
- ⛔ **Reservas de stock en ventas y proformas** (la pantalla de Reservas queda vacía).
- ⛔ **Crear clientes desde el POS** (hay que registrarlos antes en Clientes).
- ⛔ **Folio de la receta en el recibo impreso.**
- ⛔ **Escaneo/foto de la receta.**
- ⛔ **Liquidación y pago de comisiones** (solo existe el reporte).
- ⛔ **Importación masiva de catálogo y stock inicial.**
- ⛔ **Integración con e-commerce y apps de delivery.**
- ⛔ **Identificar la farmacia por subdominio.**

**Reglas provisionales** (funcionan, pero están pendientes de confirmar con el docente): clasificaciones de venta, acta de baja, libro de controlados, costo promedio, comisiones, puntos, convenios y analítica. Ver `GUIA_DECISIONES.md` y `REGISTRO_DECISIONES.md`.

**Salvedades conocidas** (anótalas si las ves):

- ⚠️ Algunos mensajes del servidor salen **en inglés** (stock insuficiente, turno solapado, egreso mayor al efectivo, precio solapado, recepción mayor a la orden).
- ⚠️ Errores de **cuarentena, liberación y merma** podrían mostrarse como «Internal server error» en lugar de un mensaje claro.

---

## Registro de fallos

Anota aquí cada prueba que no salió como se esperaba.

| Código | Qué hice | Qué esperaba | Qué pasó | Captura |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
