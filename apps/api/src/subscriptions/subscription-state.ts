export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELED";

export interface SubscriptionState {
  status: SubscriptionStatus;
  startsAt: Date;
  trialEndsAt?: Date;
  graceEndsAt?: Date;
}

export function createTrialSubscription(startsAt: Date): SubscriptionState {
  return {
    status: "TRIALING",
    startsAt,
    trialEndsAt: addDays(startsAt, 7),
    graceEndsAt: undefined
  };
}

export function createActiveSubscription(startsAt: Date): SubscriptionState {
  return {
    status: "ACTIVE",
    startsAt,
    trialEndsAt: undefined,
    graceEndsAt: undefined
  };
}

export function transitionSubscription(
  current: SubscriptionStatus,
  next: SubscriptionStatus,
  occurredAt: Date
): Pick<SubscriptionState, "status" | "graceEndsAt"> {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`Cannot transition a subscription from ${current} to ${next}.`);
  }

  return {
    status: next,
    graceEndsAt: next === "PAST_DUE" ? addDays(occurredAt, 3) : undefined
  };
}

const allowedTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ["ACTIVE", "SUSPENDED", "CANCELED"],
  ACTIVE: ["PAST_DUE", "CANCELED"],
  PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELED"],
  SUSPENDED: ["ACTIVE", "CANCELED"],
  CANCELED: []
};

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
