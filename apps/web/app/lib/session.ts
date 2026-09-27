export interface LoginInput {
  email: string;
  password: string;
  /** Identificador de la farmacia (opcional si el usuario tiene una sola). */
  tenant?: string;
  branchId?: string;
}

export interface BranchOption {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
}

/** El login puede terminar, pedir sucursal o pedir el código 2FA. */
export type LoginResult =
  | { status: "ok" }
  | { status: "branch"; options: BranchOption[] }
  | { status: "totp"; challengeToken: string };

export interface AuthSession {
  userId: string;
  tenantId: string;
  branchId: string;
  permissions: string[];
}

interface TokenResponse {
  accessToken: string;
  expiresInSeconds: number;
}

const accessTokenKey = "farmaxia.access_token";
export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

function token(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(accessTokenKey);
}

function storeToken(value: string): void {
  window.sessionStorage.setItem(accessTokenKey, value);
}

export const storeAccessToken = storeToken;

async function tokenResponse(response: Response): Promise<TokenResponse> {
  if (!response.ok) {
    throw new Error("No pudimos iniciar la sesión. Verifica tus datos e inténtalo nuevamente.");
  }
  return (await response.json()) as TokenResponse;
}

async function loginError(response: Response): Promise<Error> {
  if (response.status === 429) {
    return new Error("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
  }
  if (response.status === 401) {
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      if (body.code === "INVALID_TOTP" && body.message) {
        return new Error(body.message);
      }
    } catch {
      // Sin cuerpo JSON: mensaje genérico.
    }
  }
  return new Error("No pudimos iniciar la sesión. Verifica tus datos e inténtalo nuevamente.");
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw await loginError(response);
  }
  const body = (await response.json()) as
    | TokenResponse
    | { requires: "BRANCH"; options: BranchOption[] }
    | { requires: "TOTP"; challengeToken: string };
  if ("requires" in body) {
    return body.requires === "BRANCH"
      ? { status: "branch", options: body.options }
      : { status: "totp", challengeToken: body.challengeToken };
  }
  storeToken(body.accessToken);
  return { status: "ok" };
}

export async function completeTotpLogin(challengeToken: string, code: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login/totp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challengeToken, code })
  });
  if (!response.ok) {
    throw await loginError(response);
  }
  storeToken(((await response.json()) as TokenResponse).accessToken);
}

async function refresh(): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
    method: "POST",
    credentials: "include"
  });
  const result = await tokenResponse(response);
  storeToken(result.accessToken);
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let accessToken = token();
  if (!accessToken) {
    await refresh();
    accessToken = token();
  }
  if (!accessToken) {
    throw new Error("SESSION_REQUIRED");
  }

  const execute = (value: string) => fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers).entries()),
      authorization: `Bearer ${value}`
    },
    credentials: "include"
  });
  let response = await execute(accessToken);
  if (response.status === 401) {
    await refresh();
    const refreshedToken = token();
    if (!refreshedToken) {
      throw new Error("SESSION_EXPIRED");
    }
    response = await execute(refreshedToken);
  }
  // 402: la suscripción no está activa. La página de suscripción explica el motivo y permite pagar.
  if (response.status === 402 && !window.location.pathname.startsWith("/billing")) {
    window.location.assign("/billing?bloqueado=1");
  }
  return response;
}

async function me(): Promise<AuthSession> {
  const accessToken = token();
  if (!accessToken) {
    throw new Error("SESSION_REQUIRED");
  }
  const response = await fetch(`${apiUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    credentials: "include",
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "SESSION_EXPIRED" : "SESSION_UNAVAILABLE");
  }
  return (await response.json()) as AuthSession;
}

export async function currentSession(): Promise<AuthSession> {
  try {
    return await me();
  } catch (error) {
    if (!(error instanceof Error) || !["SESSION_REQUIRED", "SESSION_EXPIRED"].includes(error.message)) {
      throw error;
    }
    await refresh();
    return me();
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${apiUrl}/api/v1/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
  } finally {
    window.sessionStorage.removeItem(accessTokenKey);
  }
}
