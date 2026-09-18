# Verification report — Backoffice inicial

## Result

PASS — la primera experiencia web autenticada cumple el contrato definido.

## Evidence

- `pnpm --filter @farmaxia/web exec tsc --noEmit`: passed.
- `pnpm --filter @farmaxia/web build`: passed; routes `/` and `/dashboard` generated.
- `pnpm --filter @farmaxia/api test`: 28 tests passed in 11 suites.
- CORS preflight from `http://localhost:3000`: HTTP 204 with credentials enabled.
- Rebuilt Docker images and `docker compose up -d`: API/web/PostgreSQL/Redis healthy.
- `GET http://localhost:3001/health`: HTTP 200.
- `GET http://localhost:3000/`: HTTP 200.

## Contract checks

- Login sends the existing tenant/sucursal context contract and includes credentials.
- Dashboard validates `/auth/me`, refreshes once through the HttpOnly cookie and redirects unauthenticated users.
- Tenant, branch and effective permissions come only from the API response.
- Modules without domain endpoints are labeled as upcoming; no business metrics are fabricated.
