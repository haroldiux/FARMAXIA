# FARMAXIA

SaaS multisucursal y multi-tenant para farmacias bolivianas.

## Requisitos

- Node.js 22.20+
- pnpm 11.19+
- Docker Desktop para PostgreSQL y Redis locales

## Inicio

```powershell
pnpm install
Copy-Item apps/api/.env.example apps/api/.env
docker compose up -d
pnpm --filter @farmaxia/api db:migrate
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001/health`
- PostgreSQL local: `localhost:5433`

Antes de iniciar la API, sustituye `AUTH_JWT_SECRET` de `apps/api/.env` por un
secreto local único de al menos 32 caracteres. Puedes generar uno con:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Verificación

```powershell
pnpm --filter @farmaxia/api test
pnpm build
pnpm --filter @farmaxia/api exec drizzle-kit check
docker compose config
```

Las migraciones usan `DATABASE_URL` (propietario de migraciones), los módulos de
dominio usan `DATABASE_APP_URL` (rol con RLS) y la identidad usa
`DATABASE_AUTH_URL` (rol de privilegio mínimo). Los valores del archivo de ejemplo
son únicamente para desarrollo local. Las pruebas crean/usan la base aislada
`farmaxia_test`.

La documentación de alcance, decisiones, contratos y pruebas está en `docs/`, `REGISTRO_DECISIONES.md` y `ESTADO_IMPLEMENTACION.md`. No hay credenciales SIAT ni datos productivos en el repositorio.
