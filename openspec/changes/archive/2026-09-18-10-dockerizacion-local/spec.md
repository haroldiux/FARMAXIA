# Specification: Dockerización local completa

## D10.1 — Composición ejecutable

`docker compose up --build -d` DEBE construir y arrancar `postgres`, `redis`,
`api` y `web`. PostgreSQL y Redis DEBEN conservar sus volúmenes y healthchecks.

## D10.2 — API migrada antes de servir

El contenedor API DEBE esperar a PostgreSQL y Redis saludables, aplicar las
migraciones Drizzle idempotentes y después escuchar en `0.0.0.0:3001`.

## D10.3 — Web accesible

El contenedor web DEBE servir el build standalone de Next.js en
`0.0.0.0:3000`, depender de la API saludable y publicar una URL de API
consumible desde el navegador local.

## D10.4 — Reproducibilidad

Las imágenes DEBEN instalar dependencias desde `pnpm-lock.yaml`, usar Node 22 y
no depender de `node_modules`, `.next` o `dist` del host.
