import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { RequireFeature } from "../saas/subscription.guard.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { ApiKeysService, type ApiKeySummary, type CreatedApiKey } from "./api-keys.service.js";
import { PublicApiService, type Page, type PublicProduct, type PublicStockItem } from "./public-api.service.js";
import {
  WebhooksService,
  type WebhookDeliverySummary,
  type WebhookEndpointInput,
  type WebhookEndpointSummary,
  type WebhookEndpointWithSecret
} from "./webhooks.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

/** F19 Module 12: API key management for the session branch (owner only, Premium). */
@Controller("api/v1/integrations/api-keys")
@RequireFeature("public_api")
@RequirePermissions("integrations.manage")
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<{ items: ApiKeySummary[] }> {
    return this.apiKeys.list(scopeFrom(request));
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: { name?: unknown }): Promise<CreatedApiKey> {
    return this.apiKeys.create(scopeFrom(request), body ?? {});
  }

  @Post(":id/revoke")
  revoke(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<ApiKeySummary> {
    return this.apiKeys.revoke(scopeFrom(request), id);
  }
}

/** F19 Module 12: tenant-wide webhook endpoints and their delivery log (owner only, Premium). */
@Controller("api/v1/integrations/webhooks")
@RequireFeature("public_api")
@RequirePermissions("integrations.manage")
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}

  @Get("event-types")
  eventTypes(): { items: Array<{ type: string; label: string }> } {
    return this.webhooks.eventTypes();
  }

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<{ items: WebhookEndpointSummary[] }> {
    return this.webhooks.list(scopeFrom(request));
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: WebhookEndpointInput): Promise<WebhookEndpointWithSecret> {
    return this.webhooks.create(scopeFrom(request), body ?? {});
  }

  @Patch(":id")
  update(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() body: WebhookEndpointInput): Promise<WebhookEndpointSummary> {
    return this.webhooks.update(scopeFrom(request), id, body ?? {});
  }

  @Post(":id/rotate-secret")
  rotateSecret(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<WebhookEndpointWithSecret> {
    return this.webhooks.rotateSecret(scopeFrom(request), id);
  }

  @Get(":id/deliveries")
  listDeliveries(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<{ items: WebhookDeliverySummary[]; limit: number; offset: number }> {
    return this.webhooks.listDeliveries(scopeFrom(request), id, { status, limit, offset });
  }
}

/**
 * F19 public read-only API (header `X-Api-Key`). `@Public()` skips the session guard; ApiKeyGuard
 * authenticates the key and checks subscription and plan. The contract is documented in public-api.service.ts.
 */
@Controller("api/public/v1")
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(@Inject(PublicApiService) private readonly publicApi: PublicApiService) {}

  @Get("products")
  listProducts(
    @Req() request: AuthenticatedRequest,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<Page<PublicProduct>> {
    return this.publicApi.listProducts(scopeFrom(request), { search, limit, offset });
  }

  @Get("products/:productId")
  getProduct(@Req() request: AuthenticatedRequest, @Param("productId") productId: string): Promise<PublicProduct> {
    return this.publicApi.getProduct(scopeFrom(request), productId);
  }

  @Get("stock")
  listStock(
    @Req() request: AuthenticatedRequest,
    @Query("presentationId") presentationId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string
  ): Promise<Page<PublicStockItem>> {
    return this.publicApi.listStock(scopeFrom(request), { presentationId, limit, offset });
  }
}
