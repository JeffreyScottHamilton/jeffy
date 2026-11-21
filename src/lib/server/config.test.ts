import { describe, expect, it } from "vitest";
import { readConfig, readVoiceConfig } from "./config";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
const base = env({
  GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
  VOICESTUDIO_BASE_URL: "http://127.0.0.1:3900/",
  VOICESTUDIO_VOICE_ID: "alloy",
});

describe("readConfig", () => {
  it("needs only the Gemini key for text chat", () => {
    expect(readConfig(env({}))).toEqual({ ok: false, missing: ["GOOGLE_GENERATIVE_AI_API_KEY"], problems: [] });
    const r = readConfig(env({ GOOGLE_GENERATIVE_AI_API_KEY: "g" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.geminiApiKey).toBe("g");
      expect(r.config.geminiTimeoutMs).toBe(50000);
      expect(r.config.voice).toEqual({
        ok: false,
        missing: ["VOICESTUDIO_BASE_URL", "VOICESTUDIO_VOICE_ID"],
        problems: [],
      });
    }
  });
  it("reads GEMINI_TIMEOUT_MS and the voice config", () => {
    const r = readConfig({ ...base, GEMINI_TIMEOUT_MS: "20000" });
    expect(r.ok && r.config.geminiTimeoutMs).toBe(20000);
    expect(r.ok && r.config.voice.ok).toBe(true);
  });
});

describe("readVoiceConfig", () => {
  it("lists missing env names only", () => {
    expect(readVoiceConfig(env({}))).toEqual({
      ok: false,
      missing: ["VOICESTUDIO_BASE_URL", "VOICESTUDIO_VOICE_ID"],
      problems: [],
    });
  });
  it("accepts loopback http without token and strips trailing slash", () => {
    const r = readVoiceConfig(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.provider).toBe("voicestudio");
      expect(r.config.voicestudio.baseUrl).toBe("http://127.0.0.1:3900");
      expect(r.config.voicestudio.responseFormat).toBe("wav");
      expect(r.config.voicestudio.timeoutMs).toBe(40000);
    }
  });
  it("rejects non-loopback http", () => {
    const r = readVoiceConfig({ ...base, VOICESTUDIO_BASE_URL: "http://voice.example.com", VOICESTUDIO_AUTH_TOKEN: "t" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("VOICESTUDIO_BASE_URL must use https unless it is a loopback address");
  });
  it("rejects non-loopback https without token", () => {
    const r = readVoiceConfig({ ...base, VOICESTUDIO_BASE_URL: "https://voice.example.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toContain("VOICESTUDIO_AUTH_TOKEN");
  });
  it("accepts non-loopback https with token", () => {
    const r = readVoiceConfig({
      ...base,
      VOICESTUDIO_BASE_URL: "https://voice.example.com",
      VOICESTUDIO_AUTH_TOKEN: "t",
      VOICESTUDIO_RESPONSE_FORMAT: "mp3",
    });
    expect(r.ok && r.config.voicestudio.responseFormat).toBe("mp3");
  });
  it("defaults to gradium when GRADIUM_API_KEY is set, and names only gradium vars", () => {
    expect(readVoiceConfig(env({ GRADIUM_API_KEY: "k" }))).toEqual({ ok: false, missing: ["GRADIUM_VOICE_ID"], problems: [] });
  });
  it("accepts gradium config with the generic timeout, falling back to the old name", () => {
    const g = { GRADIUM_API_KEY: "k", GRADIUM_VOICE_ID: "v" };
    let r = readVoiceConfig(env(g));
    expect(r.ok && r.config.provider).toBe("gradium");
    expect(r.ok && r.config.gradium).toEqual({ apiKey: "k", voiceId: "v", timeoutMs: 40000 });
    r = readVoiceConfig(env({ ...g, VOICESTUDIO_TIMEOUT_MS: "30000" }));
    expect(r.ok && r.config.gradium.timeoutMs).toBe(30000);
    r = readVoiceConfig(env({ ...g, VOICE_TIMEOUT_MS: "20000", VOICESTUDIO_TIMEOUT_MS: "30000" }));
    expect(r.ok && r.config.gradium.timeoutMs).toBe(20000);
  });
  it("explicit VOICE_PROVIDER wins and names only that provider's vars", () => {
    let r = readVoiceConfig({ ...base, GRADIUM_API_KEY: "k", VOICE_PROVIDER: "voicestudio" });
    expect(r.ok && r.config.provider).toBe("voicestudio");
    r = readVoiceConfig(env({ VOICE_PROVIDER: "gradium" }));
    expect(r).toEqual({ ok: false, missing: ["GRADIUM_API_KEY", "GRADIUM_VOICE_ID"], problems: [] });
    r = readVoiceConfig({ ...base, VOICE_PROVIDER: "nope" });
    expect(!r.ok && r.problems).toContain("VOICE_PROVIDER must be gradium or voicestudio");
  });
});
