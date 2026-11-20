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
  it("defaults to gradium when GRADIUM_API_KEY is set, and names only gradium vars", () => {
    const r = readConfig({ GOOGLE_GENERATIVE_AI_API_KEY: "g", GRADIUM_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, missing: ["GRADIUM_VOICE_ID"], problems: [] });
  });
  it("accepts gradium config with the generic timeout, falling back to the old name", () => {
    const env = { GOOGLE_GENERATIVE_AI_API_KEY: "g", GRADIUM_API_KEY: "k", GRADIUM_VOICE_ID: "v" };
    let r = readConfig(env as unknown as NodeJS.ProcessEnv);
    expect(r.ok && r.config.voiceProvider).toBe("gradium");
    expect(r.ok && r.config.gradium).toEqual({ apiKey: "k", voiceId: "v", timeoutMs: 40000 });
    r = readConfig({ ...env, VOICESTUDIO_TIMEOUT_MS: "30000" } as unknown as NodeJS.ProcessEnv);
    expect(r.ok && r.config.gradium.timeoutMs).toBe(30000);
    r = readConfig({ ...env, VOICE_TIMEOUT_MS: "20000", VOICESTUDIO_TIMEOUT_MS: "30000" } as unknown as NodeJS.ProcessEnv);
    expect(r.ok && r.config.gradium.timeoutMs).toBe(20000);
  });
  it("explicit VOICE_PROVIDER wins and names only that provider's vars", () => {
    let r = readConfig({ ...base, GRADIUM_API_KEY: "k", VOICE_PROVIDER: "voicestudio" } as unknown as NodeJS.ProcessEnv);
    expect(r.ok && r.config.voiceProvider).toBe("voicestudio");
    r = readConfig({ GOOGLE_GENERATIVE_AI_API_KEY: "g", VOICE_PROVIDER: "gradium" } as unknown as NodeJS.ProcessEnv);
    expect(r).toEqual({ ok: false, missing: ["GRADIUM_API_KEY", "GRADIUM_VOICE_ID"], problems: [] });
    r = readConfig({ ...base, VOICE_PROVIDER: "nope" } as unknown as NodeJS.ProcessEnv);
    expect(!r.ok && r.problems).toContain("VOICE_PROVIDER must be gradium or voicestudio");
  });
});
