import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SubscriptionInactiveException } from "../saas/subscription.guard.js";
import type { TenantScope } from "../database/tenant-database.js";
import type { FeatureService } from "../subscriptions/feature.service.js";
import { SubscriptionAccessError } from "../subscriptions/quota.service.js";

export const ZONE = "America/La_Paz";
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({ code: "INVALID_INPUT", field, message });
}

export function isRealDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isRealDate(value)) {
    throw invalid(field, "La fecha no es válida (use AAAA-MM-DD).");
  }
  return value;
}

/** Inclusive period (La Paz calendar days) required by the reports. */
export function requiredPeriod(from: unknown, to: unknown): { from: string; to: string } {
  const start = optionalDate(from, "from");
  const end = optionalDate(to, "to");
  if (!start) throw invalid("from", "Indique la fecha inicial (AAAA-MM-DD).");
  if (!end) throw invalid("to", "Indique la fecha final (AAAA-MM-DD).");
  if (start > end) throw invalid("to", "La fecha final no puede ser anterior a la inicial.");
  return { from: start, to: end };
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw invalid(field, "El identificador no es válido.");
  }
  return value;
}

/** Throws 403 PLAN_FEATURE_RESTRICTED (or 402 when the subscription is inactive) like the HTTP guard. */
export async function requireFeature(features: FeatureService, scope: TenantScope, featureCode: string): Promise<void> {
  if (await featureEnabled(features, scope, featureCode)) return;
  throw new ForbiddenException({
    statusCode: 403,
    code: "PLAN_FEATURE_RESTRICTED",
    message: "Tu plan no incluye esta funcionalidad.",
    feature: featureCode
  });
}

/** Plan check that does not throw when the plan simply lacks the feature (still 402 on inactive subscriptions). */
export async function featureEnabled(features: FeatureService, scope: TenantScope, featureCode: string): Promise<boolean> {
  try {
    return await features.isEnabled(scope, featureCode);
  } catch (error) {
    if (error instanceof SubscriptionAccessError) throw new SubscriptionInactiveException();
    throw error;
  }
}
