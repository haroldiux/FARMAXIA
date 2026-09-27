export interface AuthContext {
  userId: string;
  tenantId: string;
  branchId: string;
}

export interface LoginInput {
  email: string;
  password: string;
  /** Identificador (slug) o UUID de la farmacia; opcional si el usuario tiene una sola. */
  tenant?: string;
  tenantId?: string;
  /** Opcional si el usuario tiene una sola sucursal en esa farmacia. */
  branchId?: string;
}

/** Datos del dispositivo para la lista de sesiones activas. */
export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface BranchOption {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
}

export type LoginOutcome =
  | { kind: "session"; tokens: SessionTokens }
  | { kind: "select_branch"; options: BranchOption[] }
  | { kind: "totp"; challengeToken: string };
