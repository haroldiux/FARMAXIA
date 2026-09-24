import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./authentication.guard.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, targets);
    const requiredAll = requiredAny?.length
      ? undefined
      : this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (!requiredAll?.length && !requiredAny?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException();
    }

    const granted = await this.authService.permissionsFor(request.auth);
    if (
      (requiredAll?.length && !requiredAll.every((permission) => granted.includes(permission))) ||
      (requiredAny?.length && !requiredAny.some((permission) => granted.includes(permission)))
    ) {
      throw new ForbiddenException();
    }
    return true;
  }
}
