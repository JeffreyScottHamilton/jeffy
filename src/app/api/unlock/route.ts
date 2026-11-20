import { AUTH_COOKIE, AUTH_MAX_AGE_SECONDS, authToken, gatePassword, safeEqual } from "@/lib/server/auth";

const MAX_BODY_BYTES = 1024;
const FAIL_DELAY_MS = 500;

const fail = async (status: number, code: string, message: string) => {
  await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
  return Response.json(
    { error: { code, message, retryable: false } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
};

export async function POST(request: Request): Promise<Response> {
  const password = gatePassword();
  if (!password) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  let given: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return fail(401, "unauthorized", "Wrong password.");
    given = (JSON.parse(text) as { password?: unknown } | null)?.password;
  } catch {
    return fail(401, "unauthorized", "Wrong password.");
  }
  if (typeof given !== "string" || !(await safeEqual(given, password))) {
    return fail(401, "unauthorized", "Wrong password.");
  }

  const secure = process.env.NODE_ENV === "production";
  const cookie = [
    `${AUTH_COOKIE}=${await authToken(password)}`,
    "Path=/",
    `Max-Age=${AUTH_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
