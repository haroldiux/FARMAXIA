/**
 * FARMAXIA - Training sandbox session persistence.
 * Keeps {active, roleCode, stepIndex} in sessionStorage so the mode survives a reload
 * (banner included) and dies on exit/logout. Pure helpers over a minimal storage interface.
 */

import { purgeSandbox } from "./sandbox-store.ts";
import { getAvailableTracks } from "../tours/track-access.ts";
import { getTrainingTrackForRole, type RoleTrainingTrack } from "../tours/role-tracks.ts";

/** Flag read by authenticatedFetch to route requests through the interceptor. */
export const SANDBOX_FLAG_KEY = "farmaxia.sandbox_active";
export const SANDBOX_STATE_KEY = "farmaxia.sandbox_state";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredSandboxSession {
  roleCode: string;
  stepIndex: number;
}

export function saveSandboxSession(storage: StorageLike, session: StoredSandboxSession): void {
  storage.setItem(SANDBOX_FLAG_KEY, "true");
  storage.setItem(SANDBOX_STATE_KEY, JSON.stringify(session));
}

export function clearSandboxSession(storage: StorageLike): void {
  storage.removeItem(SANDBOX_FLAG_KEY);
  storage.removeItem(SANDBOX_STATE_KEY);
}

/**
 * Reads the stored session. Anything inconsistent (flag without valid state, unknown role)
 * is cleared so the interceptor never stays on without a visible banner.
 */
export function loadSandboxSession(storage: StorageLike): StoredSandboxSession | null {
  if (storage.getItem(SANDBOX_FLAG_KEY) !== "true") {
    return null;
  }
  try {
    const raw = storage.getItem(SANDBOX_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredSandboxSession>) : null;
    const track = parsed && typeof parsed.roleCode === "string" ? getTrainingTrackForRole(parsed.roleCode) : null;
    if (parsed && track && typeof parsed.stepIndex === "number" && Number.isFinite(parsed.stepIndex)) {
      const stepIndex = Math.min(Math.max(0, Math.trunc(parsed.stepIndex)), track.steps.length - 1);
      return { roleCode: track.roleCode, stepIndex };
    }
  } catch {
    // Corrupt JSON falls through to cleanup.
  }
  clearSandboxSession(storage);
  return null;
}

/**
 * Restores a stored session after a reload. Store data lives in memory only, so the
 * baseline is reseeded for the restored role.
 */
export function restoreSandboxSession(
  storage: StorageLike,
  allowedPermissions?: readonly string[],
): { track: RoleTrainingTrack; stepIndex: number } | null {
  const stored = loadSandboxSession(storage);
  const track = stored ? getTrainingTrackForRole(stored.roleCode) : null;
  if (!stored || !track) {
    return null;
  }
  // The user may have lost access since the session was stored: leave the sandbox cleanly.
  if (allowedPermissions && !getAvailableTracks(allowedPermissions).some((item) => item.id === track.id)) {
    exitSandboxSession(storage);
    return null;
  }
  purgeSandbox(track.roleCode);
  return { track, stepIndex: stored.stepIndex };
}

/**
 * Starts training for a role: seeds that role's baseline data and persists the session.
 * Returns the track, or null (leaving storage untouched) for an unknown role.
 */
export function startSandboxSession(storage: StorageLike, roleCode: string): RoleTrainingTrack | null {
  const track = getTrainingTrackForRole(roleCode);
  if (!track || !track.steps.length) {
    return null;
  }
  purgeSandbox(track.roleCode);
  saveSandboxSession(storage, { roleCode: track.roleCode, stepIndex: 0 });
  return track;
}

/** Leaves the sandbox: removes every sandbox key and wipes the in-memory store. */
export function exitSandboxSession(storage: StorageLike): void {
  clearSandboxSession(storage);
  purgeSandbox();
}
