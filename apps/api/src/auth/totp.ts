import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238): códigos de 6 dígitos cada 30 s, compatibles con Google Authenticator,
// Microsoft Authenticator o Authy.
const stepSeconds = 30;
const digits = 6;
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpUri(secret: string, accountName: string, issuer = "FARMAXIA"): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(digits), period: String(stepSeconds) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function currentTotpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / stepSeconds);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Devuelve el paso aceptado (±1 paso de tolerancia por desfase de reloj) o null.
 * `lastUsedStep` impide reutilizar un código ya aceptado.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  const current = currentTotpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) {
      continue;
    }
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(normalized))) {
      return step;
    }
  }
  return null;
}

/**
 * El secreto 2FA se guarda cifrado (AES-256-GCM). La clave sale de AUTH_ENCRYPTION_KEY o,
 * si no existe, de AUTH_JWT_SECRET: cambiar esa clave obliga a reconfigurar el 2FA.
 */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function openSecret(sealed: string): string {
  if (!sealed.startsWith("v1:")) {
    throw new Error("Unsupported secret format.");
  }
  const raw = Buffer.from(sealed.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

function encryptionKey(): Buffer {
  const source = process.env.AUTH_ENCRYPTION_KEY ?? process.env.AUTH_JWT_SECRET;
  if (!source || source.length < 32) {
    throw new Error("AUTH_ENCRYPTION_KEY or AUTH_JWT_SECRET must contain at least 32 characters.");
  }
  return Buffer.from(hkdfSync("sha256", source, "farmaxia", "totp-secret-v1", 32));
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = base32Alphabet.indexOf(character);
    if (index === -1) {
      throw new Error("Invalid base32 secret.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
