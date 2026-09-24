import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";
export const PERMISSIONS_KEY = "permissions";
export const ANY_PERMISSIONS_KEY = "anyPermissions";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
