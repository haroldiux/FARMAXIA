/**
 * FARMAXIA - Shared HTTP helpers for the training sandbox interceptor and its route handlers.
 */

export interface SandboxInterceptResult {
  handled: boolean;
  status: number;
  body: unknown;
}

/**
 * Parses JSON body from RequestInit safely.
 */
export function parseBody<T>(init?: RequestInit): T | null {
  if (!init?.body) return null;
  try {
    if (typeof init.body === "string") {
      return JSON.parse(init.body) as T;
    }
  } catch {
    return null;
  }
  return null;
}

export function ok(body: unknown, status = 200): SandboxInterceptResult {
  return { handled: true, status, body };
}

export function badRequest(error: unknown, fallback: string): SandboxInterceptResult {
  return {
    handled: true,
    status: 400,
    body: { message: error instanceof Error ? error.message : fallback },
  };
}
