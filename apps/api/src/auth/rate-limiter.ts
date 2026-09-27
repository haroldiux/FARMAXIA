import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Límite en memoria por clave (IP, o IP + correo). Suficiente para una instancia; con
 * varias instancias debería moverse a Redis.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly code: string,
    private readonly message: string
  ) {}

  check(key: string, now = Date.now()): void {
    const recent = this.recent(key, now);
    if (recent.length >= this.max) {
      throw new HttpException({ statusCode: 429, code: this.code, message: this.message }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.attempts.set(key, recent);
  }

  /** Olvida los intentos de una clave (por ejemplo, tras un login correcto). */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  private recent(key: string, now: number): number[] {
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (this.attempts.size > 10_000) {
      this.attempts.clear();
    }
    return recent;
  }
}
