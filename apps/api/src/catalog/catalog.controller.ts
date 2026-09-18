import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { CatalogService, type CatalogCategoryInput, type CatalogListQuery, type CatalogPresentationInput, type CatalogProductInput } from "./catalog.service.js";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@Controller("api/v1/catalog")
@RequirePermissions("catalog.manage")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
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
}
