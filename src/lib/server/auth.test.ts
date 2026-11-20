import { describe, expect, it } from "vitest";
import { authToken, isAuthorized, readCookie, safeEqual } from "./auth";

const env = (JEFFY_PASSWORD?: string) => ({ JEFFY_PASSWORD }) as unknown as NodeJS.ProcessEnv;
const PW = "fake-test-password";

describe("auth helpers", () => {
  it("allows everything when the gate is off", async () => {
    expect(await isAuthorized(undefined, env())).toBe(true);
    expect(await isAuthorized(undefined, env(""))).toBe(true);
  });
  it("requires the exact token when the gate is on", async () => {
    const token = await authToken(PW);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await isAuthorized(token, env(PW))).toBe(true);
    expect(await isAuthorized(undefined, env(PW))).toBe(false);
    expect(await isAuthorized("nope", env(PW))).toBe(false);
    expect(await isAuthorized(token, env("other-password"))).toBe(false);
  });
  it("safeEqual compares strings of any length", async () => {
    expect(await safeEqual("a", "a")).toBe(true);
    expect(await safeEqual("a", "ab")).toBe(false);
  });
  it("parses cookies", () => {
    expect(readCookie("a=1; jeffy_auth=xyz; b=2", "jeffy_auth")).toBe("xyz");
    expect(readCookie(null, "jeffy_auth")).toBeUndefined();
    expect(readCookie("xjeffy_auth=1", "jeffy_auth")).toBeUndefined();
  });
});
