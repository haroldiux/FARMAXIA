import { BadRequestException } from "@nestjs/common";

/** Regla única de contraseñas: alta de farmacia, cambio propio y usuarios creados por un admin. */
export function assertStrongPassword(password: unknown, field = "password"): string {
  const value = typeof password === "string" ? password : "";
  if (value.length < 10 || value.length > 128 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new BadRequestException({
      code: "WEAK_PASSWORD",
      field,
      message: "La contraseña debe tener al menos 10 caracteres, con letras y números."
    });
  }
  return value;
}
