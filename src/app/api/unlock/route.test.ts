import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authToken } from "@/lib/server/auth";
import { POST } from "./route";

const PW = "fake-test-password";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/unlock", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => vi.stubEnv("JEFFY_PASSWORD", PW));
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/unlock", () => {
  it("sets the auth cookie on the right password", async () => {
    const r = await post({ password: PW });
    expect(r.status).toBe(204);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toContain(`jeffy_auth=${await authToken(PW)}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).not.toContain(PW);
  });
  it("401s on wrong, missing, malformed and oversized input", async () => {
    for (const b of [{ password: "wrong" }, {}, "not json", { password: "x".repeat(2000) }]) {
      const r = await post(b);
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });
});
