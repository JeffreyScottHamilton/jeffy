// Shared password-gate helpers. Used by proxy.ts (Web Crypto only) and route handlers.
export const AUTH_COOKIE = "jeffy_auth";
export const AUTH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

// The gate is off unless JEFFY_PASSWORD is set to a non-empty value.
export function gatePassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.JEFFY_PASSWORD || undefined;
}

export const authToken = (password: string) => hmac(password, "jeffy-auth-v1");

// Compares digests of both inputs so length and content don't leak through timing.
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac("jeffy-compare", a), hmac("jeffy-compare", b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// True when the gate is off, or the cookie carries the valid token for the current password.
export async function isAuthorized(
  cookieValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const password = gatePassword(env);
  if (!password) return true;
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await authToken(password));
}

export const requestAuthorized = (request: Request, env: NodeJS.ProcessEnv = process.env) =>
  isAuthorized(readCookie(request.headers.get("cookie"), AUTH_COOKIE), env);
