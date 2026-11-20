import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

const base = {
  GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
  VOICESTUDIO_BASE_URL: "http://127.0.0.1:3900/",
  VOICESTUDIO_VOICE_ID: "alloy",
} as unknown as NodeJS.ProcessEnv;

describe("readConfig", () => {
  it("lists missing env names only", () => {
    const r = readConfig({} as unknown as NodeJS.ProcessEnv);
    expect(r).toEqual({
      ok: false,
      missing: ["GOOGLE_GENERATIVE_AI_API_KEY", "VOICESTUDIO_BASE_URL", "VOICESTUDIO_VOICE_ID"],
      problems: [],
    });
  });
  it("accepts loopback http without token and strips trailing slash", () => {
    const r = readConfig(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.voicestudio.baseUrl).toBe("http://127.0.0.1:3900");
      expect(r.config.voicestudio.responseFormat).toBe("wav");
      expect(r.config.voicestudio.timeoutMs).toBe(40000);
      expect(r.config.geminiTimeoutMs).toBe(15000);
    }
  });
  it("rejects non-loopback http", () => {
    const r = readConfig({ ...base, VOICESTUDIO_BASE_URL: "http://voice.example.com", VOICESTUDIO_AUTH_TOKEN: "t" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("VOICESTUDIO_BASE_URL must use https unless it is a loopback address");
  });
  it("rejects non-loopback https without token", () => {
    const r = readConfig({ ...base, VOICESTUDIO_BASE_URL: "https://voice.example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toContain("VOICESTUDIO_AUTH_TOKEN");
  });
  it("accepts non-loopback https with token", () => {
    const r = readConfig({ ...base, VOICESTUDIO_BASE_URL: "https://voice.example.com", VOICESTUDIO_AUTH_TOKEN: "t", VOICESTUDIO_RESPONSE_FORMAT: "mp3" });
    expect(r.ok && r.config.voicestudio.responseFormat).toBe("mp3");
  });
});
