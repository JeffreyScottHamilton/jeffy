import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/gemini")>("@/lib/server/gemini");
  return { streamReply: vi.fn(), cleanReply: actual.cleanReply, GEMINI_MODEL: "x" };
});
vi.mock("@/lib/server/voicestudio", () => ({ synthesize: vi.fn() }));
vi.mock("@/lib/server/gradium", () => ({ synthesizeGradium: vi.fn(), streamGradium: vi.fn() }));

import { MAX_ATTACHMENT_BYTES } from "@/lib/api-types";
import { RateLimitError, VoiceOfflineError, VoiceTimeoutError } from "@/lib/server/errors";
import { streamReply, type ReplyChunk } from "@/lib/server/gemini";
import { streamGradium } from "@/lib/server/gradium";
import { synthesize } from "@/lib/server/voicestudio";
import { POST } from "./route";

const KEY = "AIza-SECRET-KEY-VALUE";
const QUESTION = "my very private question text";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/chat", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const PNG = b64(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", KEY);
  vi.stubEnv("VOICESTUDIO_BASE_URL", "http://127.0.0.1:3900");
  vi.stubEnv("VOICESTUDIO_VOICE_ID", "alloy");
  vi.stubEnv("GRADIUM_API_KEY", "");
  vi.stubEnv("VOICE_PROVIDER", "");
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
const types = async (r: Response) => (await events(r)).map((e) => e.type);
const logged = () => JSON.stringify(errSpy.mock.calls);
const expect400 = async (body: unknown, message?: string) => {
  const r = await post(body);
  expect(r.status).toBe(400);
  const j = await r.json();
  expect(j.error.code).toBe("invalid_request");
  if (message) expect(j.error.message).toContain(message);
};

describe("POST /api/chat validation", () => {
  it("400 on empty / whitespace / non-string / bad JSON / array body", async () => {
    for (const b of [{ question: "   " }, { question: 3 }, "not json", {}, "[]"]) await expect400(b);
  });
  it("400 on a too-long question and an oversized body", async () => {
    await expect400({ question: "a".repeat(4001) }, "Keep messages under 4000 characters.");
    await expect400({ question: "hi", history: "x".repeat(4.5 * 1024 * 1024) }, "too large");
  });
  it("400 on an invalid mode or non-boolean flags", async () => {
    await expect400({ question: QUESTION, mode: "shout" });
    await expect400({ question: QUESTION, mode: 3 });
    for (const k of ["voice", "search", "think"]) await expect400({ question: QUESTION, [k]: "yes" });
  });
  it("400 on bad attachments: mime, base64, size, count, name", async () => {
    const att = (o: Record<string, unknown>) => ({ question: QUESTION, attachments: [{ name: "a.png", mime: "image/png", data: PNG, ...o }] });
    await expect400(att({ mime: "image/svg+xml" }), "Attach images");
    await expect400(att({ mime: "application/x-msdownload" }), "Attach images");
    await expect400(att({ data: "not base64!" }), "could not be read");
    await expect400(att({ data: "abc" }), "could not be read");
    await expect400(att({ data: "" }), "could not be read");
    await expect400(att({ name: "x".repeat(201) }), "names");
    await expect400(att({ name: 5 }), "names");
    await expect400({ question: QUESTION, attachments: "nope" });
    await expect400({ question: QUESTION, attachments: [null] });
    const big = b64(new Uint8Array(MAX_ATTACHMENT_BYTES / 2 + 1));
    await expect400(
      { question: QUESTION, attachments: [{ name: "a.pdf", mime: "application/pdf", data: big }, { name: "b.pdf", mime: "application/pdf", data: big }] },
      "3 MB",
    );
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, mime: "image/png", data: PNG }));
    await expect400({ question: QUESTION, attachments: five }, "at most 4");
    expect(streamReply).not.toHaveBeenCalled();
  });
  it("accepts valid attachments and sends them on the final turn", async () => {
    const r = await post({
      question: QUESTION,
      history: [{ question: "q", reply: "r" }],
      attachments: [
        { name: "a.png", mime: "image/png", data: PNG },
        { name: "n.md", mime: "text/markdown", data: b64("hello") },
      ],
    });
    expect(r.status).toBe(200);
    await r.text();
    const prompt = vi.mocked(streamReply).mock.calls[0][0];
    expect(prompt.contents).toHaveLength(3);
    expect(prompt.contents[2].parts).toHaveLength(3);
    expect(prompt.contents[2].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: PNG } });
  });
  it("truncates history turns by code points and keeps the last 12", async () => {
    const long = "😀".repeat(7000);
    const history = Array.from({ length: 14 }, (_, i) => ({ question: i === 13 ? long : `q${i}`, reply: "r" }));
    await (await post({ question: QUESTION, history: [...history, { bad: 1 }] })).text();
    const { contents } = vi.mocked(streamReply).mock.calls[0][0];
    expect(contents).toHaveLength(25);
    expect(contents[0].parts[0]).toEqual({ text: "q2" });
    const q = (contents[22].parts[0] as { text: string }).text;
    expect(Array.from(q)).toHaveLength(6000);
    expect(q.endsWith("😀")).toBe(true);
  });
  it("503 config_missing only for the Gemini key, without secret values", async () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const r = await post({ question: QUESTION });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error.code).toBe("config_missing");
    expect(body.error.message).toContain("Missing: GOOGLE_GENERATIVE_AI_API_KEY.");
  });
});

describe("POST /api/chat streaming", () => {
  it("streams reasoning -> search -> text -> text_done -> sources, markdown preserved, options passed", async () => {
    const sources = [{ url: "https://a.example/", title: "A" }];
    mockChunks([
      { kind: "reasoning", delta: "Let me look this up." },
      { kind: "search", queries: ["coffee"] },
      { kind: "text", delta: "**Black**, " },
      { kind: "text", delta: "strong." },
      { kind: "sources", sources },
    ]);
    const r = await post({ question: "How do you like coffee?", search: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/x-ndjson");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const ev = await events(r);
    expect(ev.map((e) => e.type)).toEqual(["reasoning", "search", "text", "text", "text_done", "sources"]);
    expect(ev[0].delta).toBe("Let me look this up.");
    expect(ev[1].queries).toEqual(["coffee"]);
    expect(ev[2].delta).toBe("**Black**, ");
    expect(ev[4].text).toBe("**Black**, strong.");
    expect(ev[5].sources).toEqual(sources);
    expect(vi.mocked(streamReply).mock.calls[0][1]).toMatchObject({ think: true, search: true, apiKey: KEY });
  });
  it("text-only works with just the Gemini key; voice is never started when voice is false", async () => {
    vi.stubEnv("VOICESTUDIO_BASE_URL", "");
    vi.stubEnv("VOICESTUDIO_VOICE_ID", "");
    for (const body of [{ question: QUESTION }, { question: QUESTION, voice: false }]) {
      expect(await types(await post(body))).toEqual(["text", "text", "text_done"]);
    }
    expect(synthesize).not.toHaveBeenCalled();
    expect(streamGradium).not.toHaveBeenCalled();
    expect(vi.mocked(streamReply).mock.calls[0][1]).toMatchObject({ think: true, search: false });
  });
  it("voice requested without voice env -> audio_error voice_config, text still answered", async () => {
    vi.stubEnv("VOICESTUDIO_BASE_URL", "");
    vi.stubEnv("VOICESTUDIO_VOICE_ID", "");
    const ev = await events(await post({ question: QUESTION, voice: true }));
    expect(ev.map((e) => e.type)).toEqual(["text", "text", "text_done", "audio_error"]);
    expect(ev[2].text).toBe("Black and **strong**, no big deal.");
    expect(ev[3]).toMatchObject({ code: "voice_config", retryable: false });
    expect(ev[3].message).toContain("VOICESTUDIO_BASE_URL");
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("VoiceStudio speaks the speakable full reply after text_done", async () => {
    mockChunks([{ kind: "text", delta: "See [docs](https://x.y) and **this**:\n```js\ncode()\n```\nDone." }]);
    const ev = await events(await post({ question: QUESTION, voice: true }));
    expect(ev.map((e) => e.type)).toEqual(["text", "text_done", "audio"]);
    expect(ev[2]).toEqual({ type: "audio", mime: "audio/wav", data: Buffer.from([9, 8, 7]).toString("base64") });
    expect(vi.mocked(synthesize).mock.calls[0][0]).toBe("See docs and this:\nDone.");
  });
  it("audio_error keeps the text and reports voice_offline / voice_timeout", async () => {
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceOfflineError());
    let ev = await events(await post({ question: QUESTION, voice: true }));
    expect(ev.map((e) => e.type)).toEqual(["text", "text", "text_done", "audio_error"]);
    expect(ev[3]).toMatchObject({ code: "voice_offline", retryable: true });
    vi.mocked(synthesize).mockRejectedValueOnce(new VoiceTimeoutError());
    ev = await events(await post({ question: QUESTION, voice: true }));
    expect(ev.at(-1)).toMatchObject({ type: "audio_error", code: "voice_timeout" });
  });
  it("talk mode implies voice, disables thinking and uses the spoken prompt", async () => {
    const ev = await events(await post({ question: QUESTION, mode: "talk", think: true }));
    expect(ev.at(-1)?.type).toBe("audio");
    expect(vi.mocked(streamReply).mock.calls[0][1]).toMatchObject({ think: false });
    expect(vi.mocked(streamReply).mock.calls[0][0].systemInstruction).toContain("live spoken conversation");
    await (await post({ question: QUESTION, mode: "text" })).text();
    expect(vi.mocked(streamReply).mock.calls[1][0].systemInstruction).not.toContain("live spoken conversation");
  });
  it("think: false is passed through", async () => {
    await (await post({ question: QUESTION, think: false })).text();
    expect(vi.mocked(streamReply).mock.calls[0][1]).toMatchObject({ think: false });
  });
  it("streams a rate-limit failure as an error event, no audio", async () => {
    mockChunks([], new RateLimitError({ retryAfterSeconds: 12 }));
    const ev = await events(await post({ question: QUESTION, voice: true }));
    expect(ev.map((e) => e.type)).toEqual(["error"]);
    expect(ev[0]).toMatchObject({ code: "rate_limited", retryable: true });
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("unexpected model errors become an error event without leaking details", async () => {
    mockChunks([{ kind: "text", delta: "partial" }], new Error(`boom ${QUESTION} ${KEY}`));
    const text = await (await post({ question: QUESTION })).text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain(QUESTION);
    expect(text).not.toContain(KEY);
  });
  it("error event when the model returns no text (reasoning only)", async () => {
    mockChunks([{ kind: "reasoning", delta: "hmm" }, { kind: "text", delta: "   " }]);
    const ev = await events(await post({ question: QUESTION }));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "model_error" });
    expect(ev.map((e) => e.type)).not.toContain("text_done");
  });
  it("never streams the system prompt", async () => {
    const text = await (await post({ question: QUESTION })).text();
    expect(text).not.toContain("systemInstruction");
    expect(text).not.toContain("You are Jeffy");
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

    it("is not started unless voice is requested", async () => {
      fakeVoice();
      expect(await types(await post({ question: QUESTION }))).toEqual(["text", "text", "text_done"]);
      expect(streamGradium).not.toHaveBeenCalled();
    });
    it("streams audio_chunk events interleaved with text, then audio_end", async () => {
      const v = fakeVoice();
      vi.mocked(streamReply).mockImplementation(async function* () {
        yield { kind: "text", delta: "Black and **strong**, " };
        await new Promise((r) => setTimeout(r, 20)); // the model is still working while audio flows
        yield { kind: "text", delta: "no big deal." };
      });
      const ev = await events(await post({ question: QUESTION, voice: true }));
      const t = ev.map((e) => e.type);
      expect(t.filter((x) => x === "audio_chunk")).toHaveLength(2);
      expect(t.at(-1)).toBe("audio_end");
      expect(t.indexOf("audio_chunk")).toBeLessThan(t.indexOf("text_done"));
      expect(t.indexOf("text")).toBeLessThan(t.indexOf("audio_chunk"));
      expect(ev.find((e) => e.type === "audio_chunk")).toEqual({
        type: "audio_chunk",
        data: Buffer.from([1, 1]).toString("base64"),
        sampleRate: 24000,
      });
      expect(v.received.join("")).toBe("Black and strong, no big deal.");
      expect(t).not.toContain("audio");
      expect(synthesize).not.toHaveBeenCalled();
      expect(vi.mocked(streamGradium).mock.calls[0][1]).toMatchObject({ apiKey: "gsk-secret", voiceId: "voice1" });
    });
    it("sends speakable text to the voice, not markdown or code", async () => {
      mockChunks([
        { kind: "text", delta: "**Hi** `there`_ see [it](https://x" },
        { kind: "text", delta: ".y)\n``" },
        { kind: "text", delta: "`py\nsecret()\n```\nbye" },
      ]);
      const v = fakeVoice();
      await (await post({ question: QUESTION, voice: true })).text();
      expect(v.received.join("")).toBe("Hi there see it\nbye");
    });
    it("a voice failure mid-stream becomes audio_error and the text continues", async () => {
      fakeVoice({ failAfter: 1 });
      const ev = await events(await post({ question: QUESTION, voice: true }));
      const t = ev.map((e) => e.type);
      expect(ev.find((e) => e.type === "text_done")?.text).toBe("Black and **strong**, no big deal.");
      expect(t.at(-1)).toBe("audio_error");
      expect(ev.at(-1)).toMatchObject({ code: "voice_offline", retryable: true });
      expect(t).not.toContain("audio_end");
    });
    it("a voice that fails to open becomes audio_error", async () => {
      vi.mocked(streamGradium).mockRejectedValue(new VoiceTimeoutError());
      const ev = await events(await post({ question: QUESTION, mode: "talk" }));
      expect(ev.map((e) => e.type).sort()).toEqual(["audio_error", "text", "text", "text_done"]);
      expect(ev.find((e) => e.type === "audio_error")).toMatchObject({ code: "voice_timeout" });
    });
    it("a model failure mid-stream ends the voice and reports the error", async () => {
      mockChunks([{ kind: "text", delta: "partial" }], new RateLimitError());
      const v = fakeVoice();
      const ev = await events(await post({ question: QUESTION, voice: true }));
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
      const r = await post({ question: QUESTION, voice: true });
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
    await (await post({ question: QUESTION, voice: true })).text();
    expect(errSpy).toHaveBeenCalled();
    expect(logged()).not.toContain(QUESTION);
    expect(logged()).not.toContain(KEY);
  });
});
