import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gemini", () => ({ generateReply: vi.fn(), GEMINI_MODEL: "x" }));
vi.mock("@/lib/server/voicestudio", () => ({ synthesize: vi.fn() }));

import { RateLimitError, VoiceOfflineError, VoiceTimeoutError } from "@/lib/server/errors";
import { generateReply } from "@/lib/server/gemini";
import { synthesize } from "@/lib/server/voicestudio";
import { POST } from "./route";

const KEY = "AIza-SECRET-KEY-VALUE";
const QUESTION = "my very private question text";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/chat", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", KEY);
  vi.stubEnv("VOICESTUDIO_BASE_URL", "http://127.0.0.1:3900");
  vi.stubEnv("VOICESTUDIO_VOICE_ID", "alloy");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.mocked(generateReply).mockResolvedValue("Black and strong, no big deal.");
  vi.mocked(synthesize).mockResolvedValue({ audio: new Uint8Array([9, 8, 7]).buffer, contentType: "audio/wav" });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  errSpy.mockRestore();
});

const logged = () => JSON.stringify(errSpy.mock.calls);

describe("POST /api/chat", () => {
  it("400 on empty / whitespace / non-string / bad JSON", async () => {
    for (const b of [{ question: "   " }, { question: 3 }, "not json", {}]) {
      const r = await post(b);
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe("invalid_request");
    }
  });
  it("400 on too-long question and oversized body", async () => {
    const r = await post({ question: "a".repeat(501) });
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toBe("Keep questions under 500 characters.");
    expect((await post({ question: "hi", history: "x".repeat(17000) })).status).toBe(400);
  });
  it("503 config_missing lists names but no secret values", async () => {
    vi.stubEnv("VOICESTUDIO_VOICE_ID", "");
    vi.stubEnv("VOICESTUDIO_BASE_URL", "");
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(503);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.error.code).toBe("config_missing");
    expect(body.error.message).toContain("Missing: VOICESTUDIO_BASE_URL, VOICESTUDIO_VOICE_ID.");
    expect(text).not.toContain(KEY);
  });
  it("429 with Retry-After", async () => {
    vi.mocked(generateReply).mockRejectedValue(new RateLimitError({ retryAfterSeconds: 12 }));
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("12");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await r.json()).error.retryable).toBe(true);
  });
  it("503 voice_offline and 504 voice_timeout", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    let r = await post({ question: QUESTION });
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("voice_offline");
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceTimeoutError());
    r = await post({ question: QUESTION });
    expect(r.status).toBe(504);
    expect((await r.json()).error.code).toBe("voice_timeout");
  });
  it("500 internal for unexpected errors", async () => {
    vi.mocked(generateReply).mockRejectedValue(new Error(`boom ${QUESTION} ${KEY}`));
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain(QUESTION);
  });
  it("200 returns audio, reply header and no-store; sends only reply to voice", async () => {
    const r = await post({ question: "How do you like your coffee?", history: [{ question: "q", reply: "r" }, { bad: 1 }] });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/wav");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(r.headers.get("x-jeffy-reply")!, "base64url").toString("utf8")).toBe("Black and strong, no big deal.");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect(vi.mocked(synthesize).mock.calls[0][0]).toBe("Black and strong, no big deal.");
    const prompt = vi.mocked(generateReply).mock.calls[0][0];
    expect(prompt.contents).toHaveLength(3);
  });
  it("console.error never contains question text or keys", async () => {
    vi.mocked(generateReply).mockRejectedValueOnce(new Error(`${QUESTION} ${KEY}`));
    await post({ question: QUESTION });
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    await post({ question: QUESTION });
    expect(errSpy).toHaveBeenCalled();
    expect(logged()).not.toContain(QUESTION);
    expect(logged()).not.toContain(KEY);
  });
});
