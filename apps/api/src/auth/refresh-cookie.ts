import type { FastifyReply } from "fastify";

export const refreshCookie = "farmaxia_refresh";
export const refreshCookiePath = "/api/v1/auth";
const refreshMaxAge = 30 * 24 * 60 * 60;

export function setRefreshCookie(response: FastifyReply, token: string): void {
  response.setCookie(refreshCookie, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: refreshCookiePath,
    maxAge: refreshMaxAge
  });
}
