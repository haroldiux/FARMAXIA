import type { PoolClient } from "pg";
import type { TenantScope } from "../database/tenant-database.js";
import { TenantDatabase } from "../database/tenant-database.js";
import {
  assertSubscriptionAccess,
  SubscriptionAccessError,
  type SubscriptionAccessState
} from "./quota.service.js";

interface EffectiveFeature extends SubscriptionAccessState {
  allowsAllFeatures: boolean;
  isEnabled: boolean | null;
}

/**
 * Resolves a tenant's entitlement from its current plan.
 * A full-access plan stays simple today while specific plans can opt in to
 * individual features through `plan_features` without changing callers.
 */
export class FeatureService {
  constructor(private readonly database: TenantDatabase) {}

  async isEnabled(scope: TenantScope, featureCode: string): Promise<boolean> {
    if (!featureCode.trim()) {
      throw new Error("Feature code must not be empty.");
    }

    return this.database.withScope(scope, async (client) => {
      const feature = await this.effectiveFeature(client, scope.tenantId, featureCode);
      assertSubscriptionAccess(feature, new Date());
      return feature.allowsAllFeatures || feature.isEnabled === true;
    });
  }

  private async effectiveFeature(
    client: PoolClient,
    tenantId: string,
    featureCode: string
  ): Promise<EffectiveFeature> {
    const { rows } = await client.query<EffectiveFeature>(
      `select
         subscription.status,
         subscription.trial_ends_at as "trialEndsAt",
         subscription.grace_ends_at as "graceEndsAt",
         plan.allows_all_features as "allowsAllFeatures",
         plan_feature.is_enabled as "isEnabled"
       from tenant_subscriptions as subscription
       join subscription_plans as plan on plan.id = subscription.plan_id
       left join plan_features as plan_feature
         on plan_feature.plan_id = plan.id
        and plan_feature.feature_code = $2
       where subscription.tenant_id = $1
         and subscription.status <> 'CANCELED'
       limit 1`,
      [tenantId, featureCode]
    );
    const feature = rows[0];
    if (!feature) {
      throw new SubscriptionAccessError();
    }
    return feature;
  }
}
