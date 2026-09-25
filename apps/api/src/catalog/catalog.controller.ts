import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
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
  type CatalogProductInput
} from "./catalog.service.js";
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
    @Query("offset") offset?: string
  ) {
    const query: CatalogListQuery = {
      search,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset)
    };
    return this.catalog.listProducts(scopeFrom(request), query);
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
