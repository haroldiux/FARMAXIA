# Proposal: Backoffice inicial autenticado

## Intent

Convertir la base Next.js en una primera experiencia web usable: login contra
la API existente y un dashboard protegido que muestre el contexto autorizado y
prepare la navegación modular.

## Scope

- Pantalla de login con email, contraseña, tenant y sucursal solicitados.
- Cliente de sesión con access token y cookie de refresh del backend.
- Dashboard protegido que valida `GET /api/v1/auth/me`.
- Navegación visual para módulos existentes/planeados, indicando los que aún no
  tienen vistas operativas.
- CORS explícito de API para el origen web local.

## Out of scope

- Alta de usuarios, selección dinámica de tenants/sucursales o recuperación de
  contraseña.
- CRUD de catálogo, inventario, compras, ventas, caja o documentos.
- Persistencia de tokens en cookies propias del frontend o métricas ficticias.

## Rollback

El dashboard puede retirarse sin afectar contratos ni tablas; el único cambio de
API es habilitar CORS para el origen configurado.
