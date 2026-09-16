import { describe, expect, it } from "vitest";
import {
  createActiveSubscription,
  createTrialSubscription,
  transitionSubscription
} from "../src/subscriptions/subscription-state.js";

const start = new Date("2026-09-16T12:00:00.000Z");

describe("subscription state", () => {
  it("creates either a seven-day trial or a directly active subscription", () => {
    expect(createTrialSubscription(start)).toEqual({
      status: "TRIALING",
      startsAt: start,
      trialEndsAt: new Date("2026-09-23T12:00:00.000Z"),
      graceEndsAt: undefined
    });
    expect(createActiveSubscription(start)).toEqual({
      status: "ACTIVE",
      startsAt: start,
      trialEndsAt: undefined,
      graceEndsAt: undefined
    });
  });

  it("enforces grace and the approved state transitions", () => {
    expect(transitionSubscription("ACTIVE", "PAST_DUE", start)).toEqual({
      status: "PAST_DUE",
      graceEndsAt: new Date("2026-09-19T12:00:00.000Z")
    });
    expect(transitionSubscription("PAST_DUE", "ACTIVE", start)).toEqual({
      status: "ACTIVE",
      graceEndsAt: undefined
    });
    expect(() => transitionSubscription("ACTIVE", "SUSPENDED", start)).toThrow();
    expect(() => transitionSubscription("CANCELED", "ACTIVE", start)).toThrow();
  });
});
