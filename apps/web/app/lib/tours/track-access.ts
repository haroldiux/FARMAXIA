/**
 * FARMAXIA - Which training tracks a signed-in user can actually complete.
 * A track is offered only when the user's real permissions open EVERY page it visits (and the
 * permission its interactive actions need), so custom roles work and nobody lands on
 * "Acceso restringido". Mappings mirror the page guards and the navigation in lib/modules.ts.
 * Gap: plan-feature gating (e.g. "Tu plan actual no incluye esta funcionalidad") is not
 * evaluated because the plan features are not part of the client session.
 */

import { stepPathname, type RoleTrainingTrack, type TrainingAction, type TrainingStep, allRoleTracks } from "./role-tracks.ts";

/** Any-of permission lists per route; the first matching pattern wins, no match needs nothing. */
const routePermissions: ReadonlyArray<readonly [pattern: RegExp, anyOf: readonly string[]]> = [
  [/^\/cash(\/|$)/, ["cash.manage"]],
  [/^\/sales\/[^/]+$/, ["sales.read"]],
  [/^\/sales(\/|$)/, ["sales.confirm"]],
  [/^\/procurement(\/|$)/, ["inventory.manage"]],
  [/^\/inventory(\/|$)/, ["inventory.manage"]],
  // Mirrors canViewCatalog in lib/catalog-access.ts.
  [/^\/catalog(\/|$)/, ["catalog.manage", "sales.confirm"]],
  [/^\/controlled(\/|$)/, ["controlled.read"]],
  [/^\/transfers(\/|$)/, ["transfers.manage"]],
  // The staff area opens for every member, but the track schedules shifts for others.
  [/^\/staff(\/|$)/, ["staff.shifts.manage"]],
  [/^\/(users|branches)(\/|$)/, ["users.manage"]],
  [/^\/analytics(\/|$)/, ["analytics.read"]],
];

/** Extra permission a step's interactive action needs on a page that is otherwise readable. */
const actionPermissions: Partial<Record<TrainingAction, string>> = {
  approve_difference: "cash.shift.approve",
  schedule_shift: "staff.shifts.manage",
};

function stepRequirements(step: TrainingStep): Array<readonly string[]> {
  const pathname = stepPathname(step);
  const requirements: Array<readonly string[]> = [];
  for (const [pattern, anyOf] of routePermissions) {
    if (pattern.test(pathname)) {
      requirements.push(anyOf);
      break;
    }
  }
  const extra = step.interactiveAction ? actionPermissions[step.interactiveAction] : undefined;
  if (extra) requirements.push([extra]);
  return requirements;
}

/** Permission requirements (any-of lists) the user fails for this track; empty means completable. */
export function missingPermissionsForTrack(
  track: RoleTrainingTrack,
  permissions: readonly string[],
): Array<readonly string[]> {
  const missing: Array<readonly string[]> = [];
  for (const step of track.steps) {
    for (const anyOf of stepRequirements(step)) {
      if (!anyOf.some((permission) => permissions.includes(permission))) missing.push(anyOf);
    }
  }
  return missing;
}

/** Tracks the user can complete end to end with the given permissions. */
export function getAvailableTracks(permissions: readonly string[]): RoleTrainingTrack[] {
  return allRoleTracks.filter((track) => missingPermissionsForTrack(track, permissions).length === 0);
}
