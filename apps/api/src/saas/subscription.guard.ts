import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth/authentication.guard.js";
import { FeatureService } from "../subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../subscriptions/quota.service.js";

export const FEATURE_KEY = "requiredFeature";

/** Exige que el plan (o un add-on) de la farmacia incluya la funcionalidad. */
export const RequireFeature = (featureCode: string) => SetMetadata(FEATURE_KEY, featureCode);

export class SubscriptionInactiveException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: "SUBSCRIPTION_INACTIVE",
        message: "La suscripción de la farmacia no está activa. Regulariza el pago para continuar."
      },
      HttpStatus.PAYMENT_REQUIRED
    );
  }
}

/**
 * Corre después de AuthenticationGuard y PermissionsGuard. Solo actúa sobre rutas
 * marcadas con @RequireFeature: suscripción vencida o suspendida → 402
 * SUBSCRIPTION_INACTIVE; funcionalidad fuera del plan → 403 PLAN_FEATURE_RESTRICTED.
 * Las rutas de suscripción y pagos no se marcan, para que una farmacia suspendida
 * siempre pueda pagar.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(FeatureService) private readonly features: FeatureService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureCode = this.reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!featureCode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      return true;
    }

    let enabled: boolean;
    try {
      enabled = await this.features.isEnabled(request.auth, featureCode);
    } catch (error) {
      if (error instanceof SubscriptionAccessError) {
        throw new SubscriptionInactiveException();
      }
      throw error;
    }
    if (!enabled) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        code: "PLAN_FEATURE_RESTRICTED",
        message: "Tu plan no incluye esta funcionalidad.",
        feature: featureCode
      });
    }
    return true;
  }
}
