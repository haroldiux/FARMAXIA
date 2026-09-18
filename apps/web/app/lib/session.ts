export interface LoginInput {
  email: string;
  password: string;
  tenantId: string;
  branchId: string;
}

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
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

function token(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(accessTokenKey);
}

function storeToken(value: string): void {
  window.sessionStorage.setItem(accessTokenKey, value);
}

async function tokenResponse(response: Response): Promise<TokenResponse> {
  if (!response.ok) {
    throw new Error("No pudimos iniciar la sesión. Verifica tus datos e inténtalo nuevamente.");
  }
  return (await response.json()) as TokenResponse;
}

export async function login(input: LoginInput): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
  const result = await tokenResponse(response);
  storeToken(result.accessToken);
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
