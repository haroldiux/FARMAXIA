# FARMAXIA

SaaS multisucursal y multi-tenant para farmacias bolivianas.

## Requisitos

- Node.js 22.20+
- pnpm 11.19+
- Docker Desktop para PostgreSQL y Redis locales

## Inicio con Docker (recomendado)

```powershell
docker compose up --build -d
docker compose ps
```

- Web: `http://localhost:3000` (registro de farmacias en `/register`)
- Panel de plataforma (operadores del SaaS): `http://localhost:3000/platform/login`
- API: `http://localhost:3001/health`
- PostgreSQL local: `localhost:5433`
- Redis local: `localhost:6379`

La API aplica automáticamente las migraciones Drizzle antes de iniciar. Para
seguir los logs usa `docker compose logs -f api web`; para detener el entorno
usa `docker compose down` (los volúmenes se conservan).

## Inicio sin contenedores (desarrollo alternativo)

```powershell
pnpm install
Copy-Item apps/api/.env.example apps/api/.env
pnpm --filter @farmaxia/api db:migrate
pnpm dev
```

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
`DATABASE_AUTH_URL` (rol de privilegio mínimo), el alta de farmacias y el panel de
plataforma usan `DATABASE_PLATFORM_URL`, y la administración de usuarios y roles usa
`DATABASE_IDENTITY_URL`. `pnpm --filter @farmaxia/api db:seed` carga
una farmacia de demostración y un operador de plataforma (ver `SEED_DATA` en
`apps/api/src/database/seed.ts`). Los valores del archivo de ejemplo
son únicamente para desarrollo local. Las pruebas crean/usan la base aislada
`farmaxia_test`.

La documentación de alcance, decisiones, contratos y pruebas está en `docs/`, `REGISTRO_DECISIONES.md` y `ESTADO_IMPLEMENTACION.md`. No hay credenciales SIAT ni datos productivos en el repositorio.
