import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/gemini")>("@/lib/server/gemini");
  return { streamReply: vi.fn(), cleanReply: actual.cleanReply, GEMINI_MODEL: "x" };
});
vi.mock("@/lib/server/voicestudio", () => ({ synthesize: vi.fn() }));
vi.mock("@/lib/server/gradium", () => ({ synthesizeGradium: vi.fn(), streamGradium: vi.fn() }));

import { authToken } from "@/lib/server/auth";
import { RateLimitError, VoiceOfflineError, VoiceTimeoutError } from "@/lib/server/errors";
import { streamReply, type ReplyChunk } from "@/lib/server/gemini";
import { streamGradium } from "@/lib/server/gradium";
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
    expect(ev.map((e) => e.type)).toEqual(["error"]);
    expect(ev[0]).toMatchObject({ code: "rate_limited", retryable: true });
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("audio_error keeps the text and reports voice_offline / voice_timeout", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    let ev = await events(await post({ question: QUESTION }));
    expect(ev.map((e) => e.type)).toEqual(["text", "text", "text_done", "audio_error"]);
    expect(ev[2].text).toBe("Black and strong, no big deal.");
    expect(ev[3]).toMatchObject({ code: "voice_offline", retryable: true });
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
    mockChunks([{ kind: "text", delta: " ** " }]);
    const ev = await events(await post({ question: QUESTION }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "model_error" });
  });
  it("streams ndjson in order: text, text_done, audio; only sends reply to voice", async () => {
    const r = await post({ question: "How do you like your coffee?", history: [{ question: "q", reply: "r" }, { bad: 1 }] });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(["text", "text", "text_done", "audio"]);
    expect(ev[0].delta).toBe("Black and strong, ");
    expect(ev[2].text).toBe("Black and strong, no big deal.");
    expect(ev[3]).toEqual({ type: "audio", mime: "audio/wav", data: Buffer.from([9, 8, 7]).toString("base64") });
    expect(vi.mocked(synthesize).mock.calls[0][0]).toBe("Black and strong, no big deal.");
    const prompt = vi.mocked(streamReply).mock.calls[0][0];
    expect(prompt.contents).toHaveLength(3);
  });
  it("never streams profile text, only topics", async () => {
    const text = await (await post({ question: QUESTION })).text();
    expect(text).not.toContain("systemInstruction");
    expect(text).not.toContain("About you");
  });
  it("400 on an invalid mode; talk mode is accepted and adds the spoken-conversation hint", async () => {
    expect((await post({ question: QUESTION, mode: "shout" })).status).toBe(400);
    expect((await post({ question: QUESTION, mode: 3 })).status).toBe(400);
    const r = await post({ question: QUESTION, mode: "talk" });
    expect(r.status).toBe(200);
    await r.text();
    expect(vi.mocked(streamReply).mock.calls[0][0].systemInstruction).toContain("live spoken conversation");
    await (await post({ question: QUESTION, mode: "text" })).text();
    expect(vi.mocked(streamReply).mock.calls[1][0].systemInstruction).not.toContain("live spoken conversation");
  });
  it("never streams reasoning or memories", async () => {
    const text = await (await post({ question: QUESTION })).text();
    expect(text).not.toContain("reasoning");
    expect(text).not.toContain("memories");
  });

  describe("gradium streaming", () => {
    beforeEach(() => {
      vi.stubEnv("VOICE_PROVIDER", "gradium");
      vi.stubEnv("GRADIUM_API_KEY", "gsk-secret");
      vi.stubEnv("GRADIUM_VOICE_ID", "voice1");
    });
    // Fake TTS: records what text it receives and emits one audio chunk per text piece it consumes.
    const fakeVoice = (opts: { failAfter?: number; hang?: boolean } = {}) => {
      const received: string[] = [];
      let aborted = false;
      vi.mocked(streamGradium).mockImplementation(async (text, _cfg, o) => {
        o?.signal?.addEventListener("abort", () => (aborted = true));
        async function* chunks() {
          let n = 0;
          for await (const piece of text) {
            received.push(piece);
            if (opts.failAfter !== undefined && n >= opts.failAfter) throw new VoiceOfflineError();
            n++;
            yield new Uint8Array([n, n]);
          }
          if (opts.hang) await new Promise(() => {});
        }
        return { sampleRate: 24000, chunks: chunks() };
      });
      return { received, wasAborted: () => aborted };
    };

    it("streams audio_chunk events interleaved with text, then audio_end", async () => {
      const v = fakeVoice();
      vi.mocked(streamReply).mockImplementation(async function* () {
        yield { kind: "text", delta: "Black and **strong**, " };
        await new Promise((r) => setTimeout(r, 20)); // the model is still working while audio flows
        yield { kind: "text", delta: "no big deal." };
      });
      const ev = await events(await post({ question: QUESTION }));
      const types = ev.map((e) => e.type);
      expect(types.filter((t) => t === "audio_chunk")).toHaveLength(2);
      expect(types.at(-1)).toBe("audio_end");
      expect(types.indexOf("audio_chunk")).toBeLessThan(types.indexOf("text_done"));
      expect(types.indexOf("text")).toBeLessThan(types.indexOf("audio_chunk"));
      expect(ev.find((e) => e.type === "audio_chunk")).toEqual({
        type: "audio_chunk",
        data: Buffer.from([1, 1]).toString("base64"),
        sampleRate: 24000,
      });
      expect(v.received.join("")).toBe("Black and strong, no big deal.");
      expect(types).not.toContain("audio");
      expect(synthesize).not.toHaveBeenCalled();
      expect(vi.mocked(streamGradium).mock.calls[0][1]).toMatchObject({ apiKey: "gsk-secret", voiceId: "voice1" });
    });
    it("sends sanitized text to the voice, not markdown", async () => {
      mockChunks([{ kind: "text", delta: "**Hi** `there`_" }]);
      const v = fakeVoice();
      await (await post({ question: QUESTION })).text();
      expect(v.received).toEqual(["Hi there"]);
    });
    it("a voice failure mid-stream becomes audio_error and the text continues", async () => {
      fakeVoice({ failAfter: 1 });
      const ev = await events(await post({ question: QUESTION }));
      const types = ev.map((e) => e.type);
      expect(types).toContain("text_done");
      expect(ev.find((e) => e.type === "text_done")?.text).toBe("Black and strong, no big deal.");
      expect(types.at(-1)).toBe("audio_error");
      expect(ev.at(-1)).toMatchObject({ code: "voice_offline", retryable: true });
      expect(types).not.toContain("audio_end");
    });
    it("a voice that fails to open becomes audio_error", async () => {
      vi.mocked(streamGradium).mockRejectedValue(new VoiceTimeoutError());
      const ev = await events(await post({ question: QUESTION }));
      expect(ev.map((e) => e.type).sort()).toEqual(["audio_error", "text", "text", "text_done"]);
      expect(ev.find((e) => e.type === "audio_error")).toMatchObject({ code: "voice_timeout" });
    });
    it("a model failure mid-stream ends the voice and reports the error", async () => {
      mockChunks([{ kind: "text", delta: "partial" }], new RateLimitError());
      const v = fakeVoice();
      const ev = await events(await post({ question: QUESTION }));
      expect(ev.at(-1)).toMatchObject({ type: "error", code: "rate_limited" });
      expect(ev.map((e) => e.type)).not.toContain("audio_end");
      expect(v.wasAborted()).toBe(true);
    });
    it("cancelling the response aborts the voice and the model", async () => {
      let modelSignal: AbortSignal | undefined;
      vi.mocked(streamReply).mockImplementation(async function* (_p, o) {
        modelSignal = o.signal;
        yield { kind: "text", delta: "Hello there" };
        await new Promise(() => {});
      });
      const v = fakeVoice();
      const r = await post({ question: QUESTION });
      const reader = r.body!.getReader();
      await reader.read();
      await reader.cancel();
      expect(v.wasAborted()).toBe(true);
      expect(modelSignal?.aborted).toBe(true);
    });
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
