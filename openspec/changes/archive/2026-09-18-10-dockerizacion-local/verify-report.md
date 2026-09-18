# Verification report — Dockerización local

## Result

PASS — la composición local construye y ejecuta API, web, PostgreSQL y Redis.

## Evidence

- `docker compose config`: configuración válida con los cuatro servicios.
- `docker compose build api web`: imágenes API y web construidas desde el lockfile con Node 22.
- `docker compose up -d`: todos los servicios iniciados; API aplicó migraciones al arrancar.
- `docker compose ps`: cuatro servicios `healthy`.
- `GET http://localhost:3001/health`: HTTP 200.
- `GET http://localhost:3000/`: HTTP 200.

## Contract checks

- API espera PostgreSQL/Redis saludables antes de iniciar.
- Web espera API saludable.
- PostgreSQL y Redis conservan sus volúmenes.
- La web usa el runtime standalone de Next.js.
- El frontend sigue siendo una base de preparación; sus vistas de negocio se
  implementarán en lotes funcionales posteriores.
