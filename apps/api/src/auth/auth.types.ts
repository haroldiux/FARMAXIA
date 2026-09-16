export interface AuthContext {
  userId: string;
  tenantId: string;
  branchId: string;
}

export interface LoginInput {
  email: string;
  password: string;
  tenantId: string;
  branchId: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}
