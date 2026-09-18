# Specification: Backoffice inicial autenticado

## F11.1 — Login

La web DEBE enviar email, contraseña, tenant solicitado y sucursal solicitada a
`POST /api/v1/auth/login` con credenciales incluidas. Un éxito DEBE guardar el
access token solo en memoria persistida del navegador y navegar al dashboard;
un fallo DEBE mostrar un mensaje genérico.

## F11.2 — Sesión protegida

El dashboard DEBE validar el token contra `GET /api/v1/auth/me`. Si no existe o
responde 401, DEBE intentar refresh mediante la cookie HttpOnly y, si falla,
volver al login. No se deben aceptar tenant o sucursal desde una cabecera libre.

## F11.3 — Contexto y permisos

La pantalla protegida DEBE mostrar tenant, sucursal y permisos efectivos
devueltos por la API. No debe inventar nombres, saldos, ventas o estados de
negocio que aún no tengan endpoint.

## F11.4 — Navegación honesta

La navegación DEBE separar módulos disponibles de módulos próximos y mantener
accesibles logout y estado de sesión.
