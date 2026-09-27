import { apiError } from "./saas";
import { authenticatedFetch, storeAccessToken, type BranchOption } from "./session";

export interface AccountProfile {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  twoFactorEnabled: boolean;
  passwordChangedAt: string | null;
  branches: BranchOption[];
}

export interface ActiveSession {
  id: string;
  current: boolean;
  startedAt: string;
  lastRefreshAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  tenantName: string | null;
  branchName: string | null;
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await authenticatedFetch(path);
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
  return (await response.json()) as T;
}

async function post(path: string, body: unknown, fallback: string): Promise<Response> {
  const response = await authenticatedFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
  return response;
}

export const accountProfile = () => getJson<AccountProfile>("/api/v1/auth/account", "No pudimos cargar tu cuenta.");
export const activeSessions = () => getJson<ActiveSession[]>("/api/v1/auth/sessions", "No pudimos cargar tus sesiones.");

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await post("/api/v1/auth/password", { currentPassword, newPassword }, "No pudimos cambiar la contraseña.");
}

export async function revokeSession(sessionId: string): Promise<void> {
  await post(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, {}, "No pudimos cerrar la sesión.");
}

export async function revokeOtherSessions(): Promise<number> {
  const response = await post("/api/v1/auth/sessions/revoke-others", {}, "No pudimos cerrar las otras sesiones.");
  return ((await response.json()) as { revoked: number }).revoked;
}

export async function setupTwoFactor(): Promise<{ secret: string; otpauthUri: string }> {
  const response = await post("/api/v1/auth/2fa/setup", {}, "No pudimos preparar la verificación en dos pasos.");
  return (await response.json()) as { secret: string; otpauthUri: string };
}

export async function enableTwoFactor(code: string): Promise<void> {
  await post("/api/v1/auth/2fa/enable", { code }, "No pudimos activar la verificación en dos pasos.");
}

export async function disableTwoFactor(password: string): Promise<void> {
  await post("/api/v1/auth/2fa/disable", { password }, "No pudimos desactivar la verificación en dos pasos.");
}

/** Cambia de sucursal dentro de la misma farmacia sin volver a escribir la contraseña. */
export async function switchBranch(branchId: string): Promise<void> {
  const response = await post("/api/v1/auth/switch-branch", { branchId }, "No pudimos cambiar de sucursal.");
  storeAccessToken(((await response.json()) as { accessToken: string }).accessToken);
}

/** "Chrome · Windows" a partir del user-agent, para que la lista sea legible. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo desconocido";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const system = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return [browser, system].filter(Boolean).join(" · ") || userAgent.slice(0, 60);
}
