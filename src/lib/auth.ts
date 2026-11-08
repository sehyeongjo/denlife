import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "denlife_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export function configuredPassword(): string | undefined {
  return process.env.APP_PASSWORD || undefined;
}

export function passwordMatches(input: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input), digest(expected));
}

function signature(payload: string, password: string): Buffer {
  const key = createHash("sha256")
    .update(`denlife-session-v1:${password}`)
    .digest();
  return createHmac("sha256", key).update(payload).digest();
}

export function createSession(password: string, now = Date.now()): string {
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  return `${payload}.${signature(payload, password).toString("base64url")}`;
}

export function verifySession(
  token: string | undefined,
  password: string | undefined,
  now = Date.now(),
): boolean {
  if (
    !token ||
    !password ||
    !/^\d{10}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(token)
  )
    return false;
  const [expires, nonce, mac] = token.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(expires) <= seconds || Number(expires) > seconds + SESSION_SECONDS)
    return false;
  const expected = signature(`${expires}.${nonce}`, password);
  const actual = Buffer.from(mac, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

// shortcut: per-instance throttling resets on cold starts; use Vercel WAF or a shared store for deployment-wide limits.
export class LoginLimiter {
  private attempts = new Map<string, { count: number; until: number }>();

  attempt(key: string, now = Date.now()): number {
    const existing = this.attempts.get(key);
    if (existing && existing.until > now) {
      if (existing.count >= 5) return Math.ceil((existing.until - now) / 1000);
      existing.count++;
      return 0;
    }
    if (this.attempts.size >= 1000)
      this.attempts.delete(this.attempts.keys().next().value!);
    this.attempts.set(key, { count: 1, until: now + 60_000 });
    return 0;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}
