# Proposal: Dockerización local completa

## Intent

Permitir que el entorno local de FARMAXIA se levante como una sola composición
Docker con PostgreSQL, Redis, API NestJS y web Next.js, sin depender de procesos
Node ejecutados fuera de contenedores.

## Scope

- Contenedor reproducible para `apps/api`.
- Contenedor reproducible para `apps/web` con Next standalone.
- Healthchecks y dependencias de arranque en Compose.
- Migraciones Drizzle automáticas antes de iniciar la API.
- Documentación de los comandos y puertos locales.

## Out of scope

- Vistas funcionales de dominio, autenticación visual o POS.
- Despliegue productivo, secretos gestionados, TLS, proxy inverso u observabilidad
  externa.

## Rollback

Los servicios `api` y `web` pueden eliminarse del Compose sin tocar los volúmenes
de PostgreSQL/Redis ni las migraciones de dominio.
