# ODD Feature: F19 Module 12 — Public API and integrations

## Objective
Give Premium pharmacies a safe way to connect external systems: tenant API keys, a read-only public REST API (catalog, current prices and available stock of the key's branch) and signed outgoing webhooks delivered from the existing outbox, plus an "Integraciones" admin screen.

## Problem / why
Module 12 is 0/3 + 1 partial in `ESTADO_FUNCIONALIDADES.md`: the outbox (`outbox_events`, `platform/outbox.service.ts`) is written by sales, cash and transfers but nothing consumes it. The plan feature `public_api` already exists (Premium only, `0015_core_saas.sql:153,193`; COMPLETO allows all).

## User constraint (2026-10-06)
The user must consult their teacher about every **important decision**. Anything that needs one is NOT implemented and is recorded as an open decision in `REGISTRO_DECISIONES.md`:
- External orders (e-commerce / delivery) creating sales or reserving stock — depends on D09 (reservations) and D03 (fiscal).
- Integration with specific delivery apps / e-commerce platforms (provider, contracts, commissions).
- Write access through the public API (creating customers, prices, stock).
Only minor technical choices are taken, marked provisional.

## Current evidence (mapping 2026-10-06)
- Outbox table `0005_transversal_services.sql:27-40`, schema `schema.ts:808-837`; only `farmaxia_app` has grants (branch-membership RLS). Event types: `sales.cash_sale_confirmed`, `sales.sale_voided`, `sales.sale_returned`, `sales.quote_*`, `cash.movement_registered`, `transfers.*`. No consumer.
- Global guards `auth.module.ts:24-35`: Authentication → Permissions → Subscription. `SubscriptionGuard` returns true without `request.auth` (`subscription.guard.ts:58`), and global guards run before controller guards, so the API-key guard must check subscription status and `public_api` itself.
- `@Public()` `auth.decorators.ts:7`; `TenantDatabase.withScope` needs tenant, branch and a user that is a branch member. `AuthDatabase` (`farmaxia_auth`) lookup-by-hash GUC pattern in `0002_restrict_auth_role_read.sql`.
- Reusable reads: `CatalogService.listProducts/getProduct`, `sales-lookup.ts` `resolveCurrentPrice` / `SalesLookupReader.lookup`, `InventoryService.getBalance`.
- Scheduler pattern `StockAlertScheduler` (`analytics/stock-alerts.service.ts:218-247`, disabled when `NODE_ENV=test`). Node 22 global `fetch`.
- Permissions: 27 (`identity.spec.ts:161`, `saas.spec.ts:157`). Next migration 0035 (`_journal.json` when 1792200000000). Next decision D77. Spec UUID ranges 910000-992000 used → use 993000+.
- Web sidebar `apps/web/app/lib/modules.ts` "Administración"; routes in `app-shell.tsx:15` `tenantRoutes`; plan lock via `planAllows` inside pages.

## Scope
API:
- Migration `0035_public_api.sql`: `api_keys` (tenant, branch, creator user, name, prefix, SHA-256 hash, last used, revoked), `webhook_endpoints` (tenant, url, secret, event types, active), `webhook_deliveries` (endpoint, outbox event, status, attempts, next attempt, last status/error); RLS; `farmaxia_auth` lookup by key-hash GUC; `farmaxia_platform` SELECT on `outbox_events` + dispatcher grants; permission `integrations.manage` (owner).
- Management (`api/v1/integrations`, `public_api` + `integrations.manage`): API keys list/create (plaintext shown once)/revoke; webhook endpoints list/create (secret shown once)/update/disable; delivery log.
- Public API (`api/public/v1`, `X-Api-Key`): products search/detail with presentations, current price and available stock in the key's branch; stock list. Read-only. Rejects revoked keys, inactive creator, lost branch membership, inactive subscription (402), plan without `public_api` (403).
- Webhook dispatcher scheduler: fans out outbox events (created after the endpoint) into deliveries without touching outbox status; POST JSON with HMAC-SHA256 signature; retries with backoff; FAILED after max attempts.
Web: "Integraciones" item in "Administración", page `/integrations` (API keys, webhooks, delivery log), Premium lock.

## Provisional technical defaults (REGISTRO D77-D80, pending teacher)
- D77: API keys belong to one branch and act with the permissions scope of their creator's branch membership; read-only; shown once, stored as SHA-256 hash; owner-only permission `integrations.manage`.
- D78: Public API is REST under `api/public/v1` with header `X-Api-Key`, simple per-key rate limit (provisional 120 req/min).
- D79: Webhooks signed `X-Farmaxia-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`, HTTPS required (http only for localhost), up to 8 attempts with exponential backoff, then FAILED.
- D80: Webhook events = existing outbox event types; dispatcher does not change `outbox_events.status` (reserved for future fiscal worker, D51).
Open (not implemented): D81 external orders → sales/reservations; D82 specific delivery / e-commerce providers; D83 write operations via public API.

## Constraints
- Branch `Denil`, no commits by the agent (user commits manually per phase, as in F13-F18).
- TDD: vitest `pnpm --filter @farmaxia/api test` against native PostgreSQL 18 on :5433 (no Docker). Web: typecheck + build.
- Existing behavior unchanged; spec UUIDs 993000+; new specs added to `vitest.config.ts` include list.

## Tasks
- [x] T1 Migration 0035 + permission + API key service/guard + key management endpoints (route: delegated writer A)
- [x] T2 Public read-only API (route: delegated writer A)
- [x] T3 Webhook endpoints management + dispatcher scheduler (route: delegated writer B)
- [x] T4 Web "Integraciones" page and sidebar item (route: delegated writer C)
- [x] T5 Docs: ESTADO module 12 + totals, REGISTRO D77-D83 (route: inline)

## Acceptance criteria
- Valid key returns catalog/price/stock of its branch only; revoked/unknown key 401; non-Premium 403; inactive subscription 402; other tenant data never visible (RLS).
- Plaintext key/secret returned only on creation; DB stores hash for keys.
- Dispatcher delivers signed payloads, retries failures, marks FAILED after max attempts, never duplicates (endpoint, event).
- Permission count 28; full API suite green; tsc clean; web typecheck + build OK.

## Progress and evidence
- 2026-10-06: mapping done, document created.

### T1-T2 (API, writer A, 2026-10-06)
Route: delegated direct (single writer). TDD: RED observed (new routes 404, 20/22 new tests failing), then GREEN.
- Migration `0035_public_api.sql` (journal idx 35): permission `integrations.manage` (module Administración, sort 85, owner only; 28 permissions); tables `api_keys` (tenant, branch, creator, name, key_prefix, key_hash unique, last_used_at, revoked_at/by), `webhook_endpoints` (tenant, url, description, secret, event_types text[], is_active, created_by, unique (tenant_id, id)), `webhook_deliveries` (tenant, endpoint, outbox event, event_type, status PENDING|SUCCEEDED|FAILED, attempts, next/last attempt, last status code/error, delivered_at; unique (endpoint_id, outbox_event_id)). RLS: `api_keys` session branch + membership for farmaxia_app; `webhook_endpoints` tenant ALL; `webhook_deliveries` tenant SELECT for farmaxia_app. farmaxia_auth: SELECT `api_keys` + UPDATE(last_used_at) only where key_hash = GUC `app.api_key_hash`. farmaxia_platform: SELECT `outbox_events`, SELECT `webhook_endpoints`, SELECT/INSERT/UPDATE `webhook_deliveries` (USING true policies). Schema mirror in `schema.ts` (`apiKeys`, `webhookEndpoints`, `webhookDeliveries`). `seed.ts` consumes `role-templates.ts` (no edit needed).
- Code `apps/api/src/integrations/`: `api-keys.service.ts` (`fxk_` + randomBytes(32) base64url, SHA-256 hex hash, 12-char display prefix, audit `integrations.api_key.created` / `integrations.api_key.revoked`, idempotent revoke), `api-key.guard.ts` (`ApiKeyAuthenticator` singleton + `ApiKeyGuard`), `public-api.service.ts` (contract comment block), `integrations.controllers.ts`, `integrations.module.ts` (registered in `app.module.ts`; provides its own `AuthDatabase` and `FeatureService`). `AuthDatabase` gains the `apiKeyHash` GUC; `sales-lookup.ts` gains reusable `branchAvailableStockLateral`.
- Endpoints: `api/v1/integrations/api-keys` GET / POST {name} / POST `:id/revoke` (`public_api` + `integrations.manage`, session branch). Public `api/public/v1` (`X-Api-Key`): GET `products?search&limit&offset`, GET `products/:productId`, GET `stock?presentationId&limit&offset`. Guard order: format check -> per-key rate limit 120/min (429 RATE_LIMITED) -> hash lookup (401 INVALID_API_KEY unknown/revoked) -> creator active + member of the active key branch (401) -> subscription (402 SUBSCRIPTION_INACTIVE) -> `public_api` (403 PLAN_FEATURE_RESTRICTED) -> last_used_at best effort.
- Tests: `integrations-api-keys.spec.ts` 14 tests, `public-api.spec.ts` 8 tests (both added to the vitest include list). Permission count 27 -> 28 in `identity.spec.ts` / `saas.spec.ts`.
- Verification: `pnpm --filter @farmaxia/api test` (run from repo root): 45 files / 415 tests, 408 passed, 7 failed. The failures are environmental and outside this change: 6 tests assert the English text `permission denied` but the local Postgres has `lc_messages = Spanish_Bolivia.1252` ("permiso denegado a la tabla ..."): analytics-alerts, controlled-prescriptions, crm-agreement-statements, crm-agreements, crm-loyalty, sales-quotes; plus 1 crm-agreements 5 s timeout that passed on rerun. Both new specs are green, and so are identity/saas. `tsc -p tsconfig.build.json --noEmit` and `tsc -p tsconfig.json --noEmit`: clean.

### T3 (API, writer B, 2026-10-06)
Route: delegated direct (single writer). TDD: RED observed (dispatcher module missing -> spec file failed to load; management routes absent -> 9/9 failing), then GREEN.
- No new migration: the masked hint is computed in SQL (`'whsec_…' || right(secret, 4)`) and endpoints are disabled via `isActive` (no DELETE), so 0035 grants suffice.
- `webhooks.service.ts` (`WebhooksService`, TenantDatabase): catalog `WEBHOOK_EVENT_TYPES` (13 outbox event types verified by grep of `eventType:` in sales/cash/transfers) + `*`; validation: URL https only (http for localhost/127.0.0.1/[::1], D79), no credentials, max 500; description max 200 (empty -> null); eventTypes non-empty array from catalog, deduplicated. Secret `whsec_` + randomBytes(32) base64url, returned only by create and rotate. Audits `integrations.webhook.created` / `.updated` (changed fields, never the secret) / `.secret_rotated`.
- Endpoints `api/v1/integrations/webhooks` (`public_api` + `integrations.manage`): GET `event-types` -> `{items:[{type,label}]}`; GET -> `{items: summary[]}` (summary = id, url, description, eventTypes, isActive, secretHint, createdByUserId, createdAt, updatedAt); POST {url, description?, eventTypes} -> 201 summary + `secret`; PATCH `:id` {url?, description?, eventTypes?, isActive?} -> summary; POST `:id/rotate-secret` -> 201 summary + new `secret`; GET `:id/deliveries?status&limit(<=200, default 50)&offset` -> `{items, limit, offset}`. Invalid id 400, other tenant 404 `WEBHOOK_NOT_FOUND`.
- `webhook-dispatcher.service.ts`: `WebhookDispatcherService.runOnce({ now, fetchImpl, timeoutMs })` on PlatformDatabase. Fan-out insert-select (active endpoints, same tenant, type match or `*`, `event.created_at >= endpoint.created_at`, not-exists + `on conflict do nothing`, batch 500); never touches `outbox_events` (D80). Claim: due PENDING deliveries of active endpoints, `for update of delivery skip locked`, batch 20, leased 2 min (next_attempt_at bump) so HTTP runs outside the transaction. POST body `{id, type, occurredAt, tenantId, branchId, data}`, headers Content-Type / User-Agent / X-Farmaxia-Event / X-Farmaxia-Delivery / X-Farmaxia-Signature `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`, redirect manual, 10 s AbortController timeout. 2xx -> SUCCEEDED; else attempts+1, last status/error (500 chars), backoff 1m/5m/15m/1h/3h/6h/12h, FAILED at 8 attempts. Inactive endpoint deliveries are held PENDING. Exports `signWebhookPayload` and `verifyWebhookSignature(secret, header, rawBody, toleranceSeconds = 300, nowSeconds)` (constant-time).
- `WebhookDispatcherScheduler`: `WEBHOOK_DISPATCH_INTERVAL_SECONDS` (default 30), disabled when NODE_ENV=test or interval <= 0, unref'd timers, no overlapping runs. Registered in `IntegrationsModule` (+ PlatformDatabase factory provider).
- Provisional/not done: the dispatcher does not re-check the tenant's plan/subscription before sending (endpoints can only be created on Premium); revisit with the teacher if a downgrade must stop deliveries.
- Tests: `integrations-webhooks.spec.ts` 9 tests (995000), `webhook-dispatcher.spec.ts` 6 tests (996000, fake fetch), both added to vitest include list.
- Verification: `pnpm --filter @farmaxia/api test`: 47 files / 430 tests, 423 passed, 7 failed — 6 known environmental `permission denied` (Spanish lc_messages: analytics-alerts, controlled-prescriptions, crm-agreement-statements, crm-agreements, crm-loyalty, sales-quotes) + 1 analytics-dashboard 10 s hook timeout that passed on rerun (13/13). Both new specs green (9 + 6). `tsc -p tsconfig.build.json --noEmit` and `tsc -p tsconfig.json --noEmit`: clean.

### T4 (Web, writer C, 2026-10-06)
Route: delegated direct (single writer). Test-first exception: the web app has no test runner, so no RED/GREEN is possible; checks are typecheck + production build.
- `app/lib/integrations.ts`: typed client (same `authenticatedFetch` + `parseError` pattern as `customers.ts`, error `message` surfaced): `listApiKeys/createApiKey/revokeApiKey`, `listWebhookEventTypes/listWebhooks/createWebhook/updateWebhook/rotateWebhookSecret/listWebhookDeliveries`, `publicApiBaseUrl` (`NEXT_PUBLIC_API_URL` + `/api/public/v1`), delivery status labels.
- Sidebar: "Integraciones" in "Administración" (`modules.ts`, permission `integrations.manage`, new `integrations` plug icon in `nav-icon.tsx`); `/integrations` added to `tenantRoutes` (`app-shell.tsx`).
- `app/integrations/page.tsx`: permission gate (owner), plan lock via `planAllows(features, "public_api")` with the 4 s plan-wait used by analytics and an own `IntegrationsPlanRequired` panel (the analytics one is not exported); tabs Claves de API / Webhooks / Cómo usar.
- `components/integrations-api-keys.tsx`: table (name, prefix, created, last used, status), create form (name, max 100 as the API), plaintext key shown once in `SecretOnce` (`credential-card` box, copy button, "no se volverá a mostrar"), revoke with confirm.
- `components/integrations-webhooks.tsx`: endpoint cards (url, description, secret hint, event chips with catalog labels, active state), create/edit form (url, description, event checkboxes; `*` disables the rest), secret shown once after create/rotate, activate/deactivate (confirm on deactivate), rotate with confirm, expandable delivery log per endpoint (status filter, attempts, last HTTP code/error, created/last attempt/delivered/next attempt, "Cargar más" pages of 50).
- "Cómo usar": base URL, `X-Api-Key`, the three endpoints, curl example, error codes, signature header and a Node.js verification snippet.
- `globals.css`: 13 small `integrations-*` rules (reuses `cash-layout`, `order-card`, `invoice-table controlled-table`, `credential-card`, `check-option`, `segmented`).
- Verification: `pnpm --filter @farmaxia/web exec tsc --noEmit`: exit 0, no output. `pnpm --filter @farmaxia/web build`: exit 0, `/integrations` prerendered as static.

- 2026-10-06 T5: ESTADO module 12 → 3 ✅ / 1 ❌ (totals 94/0/9, ~91%), REGISTRO D77-D80 provisional and D81-D83 open. Parent spot checks: `npx vitest run test/public-api.spec.ts` green, `npx vitest run test/webhook-dispatcher.spec.ts` 6/6, `pnpm --filter @farmaxia/web exec tsc --noEmit` exit 0.

## Next step
Feature complete. User commits manually; D77-D83 to review with the teacher. Known env failures: 6 specs asserting English "permission denied" fail with the Spanish PostgreSQL locale.
