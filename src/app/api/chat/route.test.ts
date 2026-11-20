import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/gemini")>("@/lib/server/gemini");
  return { streamReply: vi.fn(), cleanReply: actual.cleanReply, GEMINI_MODEL: "x" };
});
vi.mock("@/lib/server/voicestudio", () => ({ synthesize: vi.fn() }));
vi.mock("@/lib/server/gradium", () => ({ synthesizeGradium: vi.fn() }));

import { authToken } from "@/lib/server/auth";
import { RateLimitError, VoiceOfflineError, VoiceTimeoutError } from "@/lib/server/errors";
import { streamReply, type ReplyChunk } from "@/lib/server/gemini";
import { synthesizeGradium } from "@/lib/server/gradium";
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
  mockChunks([
    { kind: "reasoning", delta: "Thinking about coffee." },
    { kind: "text", delta: "Black and **strong**, " },
    { kind: "text", delta: "no big deal." },
  ]);
  vi.mocked(synthesize).mockResolvedValue({ audio: new Uint8Array([9, 8, 7]).buffer, contentType: "audio/wav" });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  errSpy.mockRestore();
});

function mockChunks(chunks: ReplyChunk[], failWith?: unknown) {
  vi.mocked(streamReply).mockImplementation(async function* () {
    for (const c of chunks) yield c;
    if (failWith) throw failWith;
  });
}
const events = async (r: Response) =>
  (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });

const logged = () => JSON.stringify(errSpy.mock.calls);

describe("POST /api/chat password gate", () => {
  it("401 without a valid cookie when JEFFY_PASSWORD is set", async () => {
    vi.stubEnv("JEFFY_PASSWORD", "fake-test-password");
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("unauthorized");
    expect(streamReply).not.toHaveBeenCalled();
  });
  it("passes with the valid cookie", async () => {
    vi.stubEnv("JEFFY_PASSWORD", "fake-test-password");
    const token = await authToken("fake-test-password");
    const r = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { cookie: `jeffy_auth=${token}` },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(r.status).toBe(200);
  });
});

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
  it("503 config_missing for malformed JEFFY_PROFILE_JSON without echoing it", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("JEFFY_PROFILE_JSON", "{not json SECRETPROFILETEXT");
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(503);
    const text = await r.text();
    const body = JSON.parse(text);
    expect(body.error.code).toBe("config_missing");
    expect(body.error.retryable).toBe(false);
    expect(body.error.message).toContain("JEFFY_PROFILE_JSON");
    expect(text).not.toContain("SECRETPROFILETEXT");
    expect(logged()).not.toContain("SECRETPROFILETEXT");
  });
  it("streams a rate-limit failure as an error event, no audio", async () => {
    mockChunks([], new RateLimitError({ retryAfterSeconds: 12 }));
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(200);
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(["memories", "error"]);
    expect(ev[1]).toMatchObject({ code: "rate_limited", retryable: true });
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("audio_error keeps the text and reports voice_offline / voice_timeout", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    let ev = await events(await post({ question: QUESTION }));
    expect(ev.map((e) => e.type)).toEqual(["memories", "reasoning", "text", "text", "text_done", "audio_error"]);
    expect(ev[4].text).toBe("Black and strong, no big deal.");
    expect(ev[5]).toMatchObject({ code: "voice_offline", retryable: true });
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceTimeoutError());
    ev = await events(await post({ question: QUESTION }));
    expect(ev.at(-1)).toMatchObject({ type: "audio_error", code: "voice_timeout" });
  });
  it("unexpected model errors become an error event without leaking details", async () => {
    mockChunks([{ kind: "text", delta: "partial" }], new Error(`boom ${QUESTION} ${KEY}`));
    const r = await post({ question: QUESTION });
    const text = await r.text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain(QUESTION);
    expect(text).not.toContain(KEY);
  });
  it("error event when the model returns no text", async () => {
    mockChunks([{ kind: "reasoning", delta: "hmm" }]);
    const ev = await events(await post({ question: QUESTION }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "model_error" });
  });
  it("streams ndjson in order: memories, reasoning, text, text_done, audio; only sends reply to voice", async () => {
    const r = await post({ question: "How do you like your coffee?", history: [{ question: "q", reply: "r" }, { bad: 1 }] });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(["memories", "reasoning", "text", "text", "text_done", "audio"]);
    expect(Array.isArray(ev[0].topics)).toBe(true);
    expect(ev[2].delta).toBe("Black and strong, ");
    expect(ev[4].text).toBe("Black and strong, no big deal.");
    expect(ev[5]).toEqual({ type: "audio", mime: "audio/wav", data: Buffer.from([9, 8, 7]).toString("base64") });
    expect(vi.mocked(synthesize).mock.calls[0][0]).toBe("Black and strong, no big deal.");
    const prompt = vi.mocked(streamReply).mock.calls[0][0];
    expect(prompt.contents).toHaveLength(3);
  });
  it("never streams profile text, only topics", async () => {
    const text = await (await post({ question: QUESTION })).text();
    expect(text).not.toContain("systemInstruction");
    expect(text).not.toContain("Profile excerpt");
  });
  it("uses gradium when configured", async () => {
    vi.stubEnv("VOICE_PROVIDER", "gradium");
    vi.stubEnv("GRADIUM_API_KEY", "gsk-secret");
    vi.stubEnv("GRADIUM_VOICE_ID", "voice1");
    vi.mocked(synthesizeGradium).mockResolvedValue({ audio: new Uint8Array([1, 2]).buffer, contentType: "audio/wav" });
    const ev = await events(await post({ question: QUESTION }));
    expect(ev.at(-1)).toEqual({ type: "audio", mime: "audio/wav", data: Buffer.from([1, 2]).toString("base64") });
    expect(vi.mocked(synthesizeGradium).mock.calls[0][0]).toBe("Black and strong, no big deal.");
    expect(vi.mocked(synthesizeGradium).mock.calls[0][1]).toMatchObject({ apiKey: "gsk-secret", voiceId: "voice1" });
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("console.error never contains question text or keys", async () => {
    mockChunks([], new Error(`${QUESTION} ${KEY}`));
    await (await post({ question: QUESTION })).text();
    mockChunks([{ kind: "text", delta: "ok" }]);
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    await (await post({ question: QUESTION })).text();
    expect(errSpy).toHaveBeenCalled();
    expect(logged()).not.toContain(QUESTION);
    expect(logged()).not.toContain(KEY);
  });
});
