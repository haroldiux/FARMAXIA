import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { RequirePermissions } from "../auth/auth.decorators.js";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import {
  BranchesService,
  type CreateBranchInput,
  type UpdateBranchInput
} from "./branches.service.js";

function scopeFrom(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new UnauthorizedException();
  }
  return request.auth;
}

@RequirePermissions("users.manage")
@Controller("api/v1/branches")
export class BranchesController {
  constructor(@Inject(BranchesService) private readonly branches: BranchesService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.branches.listBranches(scopeFrom(request));
  }

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateBranchInput) {
    return this.branches.createBranch(scopeFrom(request), input);
  }

  @Patch(":branchId")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("branchId") branchId: string,
    @Body() input: UpdateBranchInput
  ) {
    return this.branches.updateBranch(scopeFrom(request), branchId, input);
  }
}
