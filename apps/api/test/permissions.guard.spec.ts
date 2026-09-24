import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "../src/auth/auth.decorators.js";
import { PermissionsGuard } from "../src/auth/permissions.guard.js";

const auth = { userId: "user-1", tenantId: "tenant-1", branchId: "branch-1" };

function createGuard(input: { all?: string[]; any?: string[]; granted: string[] }) {
  const reflector = {
    getAllAndOverride: vi.fn((key: string) =>
      key === PERMISSIONS_KEY ? input.all : key === ANY_PERMISSIONS_KEY ? input.any : undefined
    )
  };
  const authService = { permissionsFor: vi.fn().mockResolvedValue(input.granted) };
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ auth }) })
  } as unknown as ExecutionContext;

  return {
    guard: new PermissionsGuard(reflector as never, authService as never),
    context,
    authService
  };
}

describe("PermissionsGuard", () => {
  it("keeps RequirePermissions as an all-of requirement", async () => {
    const { guard, context } = createGuard({
      all: ["cash.manage", "cash.shift.approve"],
      granted: ["cash.manage"]
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("accepts sales.confirm through an any-of requirement without management permission", async () => {
    const { guard, context, authService } = createGuard({
      all: ["cash.manage"],
      any: ["cash.manage", "sales.confirm"],
      granted: ["sales.confirm"]
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authService.permissionsFor).toHaveBeenCalledWith(auth);
  });

  it("rejects an any-of requirement when no permission is granted", async () => {
    const { guard, context } = createGuard({
      all: ["cash.manage"],
      any: ["cash.manage", "sales.confirm"],
      granted: ["catalog.manage"]
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
