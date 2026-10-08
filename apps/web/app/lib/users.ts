import { apiError } from "./saas";
import { authenticatedFetch } from "./session";

export interface TenantUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  twoFactorEnabled: boolean;
  managedHere: boolean;
  roles: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
}

export interface TenantRole {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  users: number;
}

export interface PermissionDefinition {
  code: string;
  label: string;
  module: string;
}

export interface TenantBranch {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path);
  if (!response.ok) {
    throw await apiError(response, response.status === 403 ? "Tu usuario no puede administrar usuarios." : "No pudimos cargar la información.");
  }
  return (await response.json()) as T;
}

async function send(path: string, method: string, body: unknown, fallback: string): Promise<Response> {
  const response = await authenticatedFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
  return response;
}

export const listUsers = () => getJson<TenantUser[]>("/api/v1/users");
export const listRoles = () => getJson<TenantRole[]>("/api/v1/roles");
export const listPermissions = () => getJson<PermissionDefinition[]>("/api/v1/permissions");
export const listBranches = () => getJson<TenantBranch[]>("/api/v1/branches");

export async function createUser(input: { displayName: string; email: string; password: string; roleIds: string[]; branchIds: string[] }): Promise<void> {
  await send("/api/v1/users", "POST", input, "No pudimos crear el usuario.");
}

export async function updateUser(userId: string, input: { displayName?: string; isActive?: boolean; roleIds?: string[]; branchIds?: string[] }): Promise<void> {
  await send(`/api/v1/users/${encodeURIComponent(userId)}`, "PATCH", input, "No pudimos guardar los cambios.");
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  await send(`/api/v1/users/${encodeURIComponent(userId)}/password`, "POST", { newPassword }, "No pudimos cambiar la contraseña.");
}

export async function resetUserTwoFactor(userId: string): Promise<void> {
  await send(`/api/v1/users/${encodeURIComponent(userId)}/2fa/reset`, "POST", {}, "No pudimos quitar la verificación en dos pasos.");
}

export async function createRole(input: { name: string; description: string; permissionCodes: string[] }): Promise<void> {
  await send("/api/v1/roles", "POST", input, "No pudimos crear el rol.");
}

export async function updateRole(roleId: string, input: { name: string; description: string; permissionCodes: string[] }): Promise<void> {
  await send(`/api/v1/roles/${encodeURIComponent(roleId)}`, "PATCH", input, "No pudimos guardar el rol.");
}

export async function deleteRole(roleId: string): Promise<void> {
  await send(`/api/v1/roles/${encodeURIComponent(roleId)}`, "DELETE", undefined, "No pudimos eliminar el rol.");
}

export async function createBranch(input: { code: string; name: string }): Promise<TenantBranch> {
  const response = await send("/api/v1/branches", "POST", input, "No pudimos crear la sucursal.");
  return (await response.json()) as TenantBranch;
}

export async function updateBranch(branchId: string, input: { code?: string; name?: string; isActive?: boolean }): Promise<TenantBranch> {
  const response = await send(`/api/v1/branches/${encodeURIComponent(branchId)}`, "PATCH", input, "No pudimos guardar los cambios de la sucursal.");
  return (await response.json()) as TenantBranch;
}

