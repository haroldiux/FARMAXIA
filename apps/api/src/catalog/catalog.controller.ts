import { RequireFeature } from "../saas/subscription.guard.js";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import {
  CatalogService,
  type BarcodeInput,
  type CatalogCategoryInput,
  type CatalogListQuery,
  type CatalogPresentationInput,
  type CatalogPriceListInput,
  type CatalogPriceInput,
  type CatalogCategoryUpdate,
  type CatalogPresentationUpdate,
  type CatalogProductInput,
  type CatalogProductUpdate
} from "./catalog.service.js";
import { defaultColdChainRange, pharmaceuticalFormSuggestions, saleClassifications } from "./product-profile.js";
import { RequireAnyPermission, RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";

interface PriceRequest extends Omit<CatalogPriceInput, "validFrom" | "validTo"> {
  validFrom: string;
  validTo?: string;
}

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

function requireIdempotencyKey(input: { idempotencyKey?: string }, header: string | undefined): string {
  const key = input.idempotencyKey?.trim() || header?.trim();
  if (!key) {
    throw new BadRequestException("An Idempotency-Key header or idempotencyKey body field is required.");
  }
  return key;
}

function optionalFlag(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be an ISO timestamp.`);
  }
  return parsed;
}

@RequireFeature("catalog")
@Controller("api/v1/catalog")
@RequirePermissions("catalog.manage")
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get("products")
  @RequireAnyPermission("catalog.manage", "sales.confirm")
  async products(
    @Req() request: AuthenticatedRequest,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("categoryId") categoryId?: string,
    @Query("controlled") controlled?: string,
    @Query("coldChain") coldChain?: string,
    @Query("includeInactive") includeInactive?: string
  ) {
    const query: CatalogListQuery = {
      search,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
      categoryId,
      controlled: optionalFlag(controlled),
      coldChain: optionalFlag(coldChain),
      includeInactive: includeInactive === "true"
    };
    return this.catalog.listProducts(scopeFrom(request), query);
  }

  @Get("options")
  @RequireAnyPermission("catalog.manage", "sales.confirm")
  options() {
    return {
      saleClassifications,
      pharmaceuticalForms: pharmaceuticalFormSuggestions,
      defaultColdChainRange
    };
  }

  @Get("products/:productId")
  @RequireAnyPermission("catalog.manage", "sales.confirm")
  product(@Req() request: AuthenticatedRequest, @Param("productId") productId: string) {
    return this.catalog.getProduct(scopeFrom(request), productId);
  }

  @HttpCode(204)
  @Patch("products/:productId")
  async updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Body() input: CatalogProductUpdate
  ): Promise<void> {
    await this.catalog.updateProduct(scopeFrom(request), productId, input);
  }

  @Get("categories")
  categories(@Req() request: AuthenticatedRequest) {
    return this.catalog.listCategories(scopeFrom(request));
  }

  @HttpCode(204)
  @Patch("categories/:categoryId")
  async updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("categoryId") categoryId: string,
    @Body() input: CatalogCategoryUpdate
  ): Promise<void> {
    await this.catalog.updateCategory(scopeFrom(request), categoryId, input);
  }

  @HttpCode(204)
  @Patch("presentations/:presentationId")
  async updatePresentation(
    @Req() request: AuthenticatedRequest,
    @Param("presentationId") presentationId: string,
    @Body() input: CatalogPresentationUpdate
  ): Promise<void> {
    await this.catalog.updatePresentation(scopeFrom(request), presentationId, input);
  }

  @Get("price-lists")
  listPriceLists(@Req() request: AuthenticatedRequest) {
    return this.catalog.listPriceLists(scopeFrom(request));
  }

  @Get("barcodes/:barcode")
  findBarcode(@Req() request: AuthenticatedRequest, @Param("barcode") barcode: string) {
    return this.catalog.findByBarcode(scopeFrom(request), barcode);
  }

  @Post("categories")
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Body() input: CatalogCategoryInput
  ): Promise<{ id: string }> {
    return this.catalog.createCategory(scopeFrom(request), input);
  }

  @Post("products")
  createProduct(
    @Req() request: AuthenticatedRequest,
    @Body() input: CatalogProductInput
  ): Promise<{ id: string }> {
    return this.catalog.createProduct(scopeFrom(request), input);
  }

  @Post("products/:productId/presentations")
  createPresentation(
    @Req() request: AuthenticatedRequest,
    @Param("productId") productId: string,
    @Body() input: Omit<CatalogPresentationInput, "productId">
  ): Promise<{ id: string }> {
    return this.catalog.createPresentation(scopeFrom(request), { ...input, productId });
  }

  @Post("price-lists")
  createPriceList(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") header: string | undefined,
    @Body() input: CatalogPriceListInput
  ): Promise<{ id: string }> {
    return this.catalog.createPriceList(scopeFrom(request), {
      ...input,
      idempotencyKey: requireIdempotencyKey(input, header)
    });
  }

  @Post("prices")
  setPrice(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") header: string | undefined,
    @Body() input: PriceRequest
  ): Promise<{ id: string }> {
    const validFrom = parseDate(input.validFrom, "validFrom");
    const validTo = parseDate(input.validTo, "validTo");
    if (!validFrom) {
      throw new BadRequestException("validFrom must be an ISO timestamp.");
    }
    return this.catalog.setPrice(scopeFrom(request), {
      ...input,
      validFrom,
      validTo,
      idempotencyKey: requireIdempotencyKey(input, header)
    });
  }

  @Post("barcodes")
  registerBarcode(
    @Req() request: AuthenticatedRequest,
    @Headers("idempotency-key") header: string | undefined,
    @Body() input: BarcodeInput
  ): Promise<{ id: string }> {
    return this.catalog.registerBarcode(scopeFrom(request), {
      ...input,
      idempotencyKey: requireIdempotencyKey(input, header)
    });
  }
}
