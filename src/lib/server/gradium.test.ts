import { afterEach, describe, expect, it, vi } from "vitest";
import { GradiumAPIError, GradiumWebSocketError } from "@gradium/sdk";
import { streamGradium, synthesizeGradium, type GradiumLike } from "./gradium";

const cfg = { apiKey: "gsk-SECRET-KEY", voiceId: "voice-1", timeoutMs: 1000 };
const TEXT = "private reply text";
const noStream = () => Promise.reject(new Error("unused"));
const fake = (impl: GradiumLike["tts"]) => () => ({ tts: impl, ttsStream: noStream });
const failing = (e: unknown) => fake(() => Promise.reject(e));

afterEach(() => vi.restoreAllMocks());

describe("synthesizeGradium", () => {
  it("returns wav audio and sends voice id, format and text", async () => {
    const tts = vi.fn().mockResolvedValue({ rawData: new Uint8Array([1, 2, 3]) });
    const r = await synthesizeGradium(TEXT, cfg, fake(tts));
    expect(r.contentType).toBe("audio/wav");
    expect(new Uint8Array(r.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(tts.mock.calls[0][0]).toEqual({ voice_id: "voice-1", output_format: "wav" });
    expect(tts.mock.calls[0][1]).toBe(TEXT);
  });

  const cases: [string, unknown, string, number | undefined][] = [
    ["401", new GradiumAPIError("x", 401, {}), "voice_auth", 401],
    ["403", new GradiumAPIError("x", 403, {}), "voice_auth", 403],
    ["402", new GradiumAPIError("x", 402, {}), "voice_quota", 402],
    ["quota message over ws", new GradiumWebSocketError("Error from server: out of credits"), "voice_quota", undefined],
    ["429", new GradiumAPIError("x", 429, {}), "voice_busy", 429],
    ["404", new GradiumAPIError("x", 404, {}), "voice_config", 404],
    ["ws error code 404", new GradiumWebSocketError("x", 404), "voice_config", 404],
    ["ws handshake 401", new GradiumWebSocketError("Unexpected server response: 401"), "voice_auth", 401],
    ["connect failure", new GradiumWebSocketError("WebSocket connection failed"), "voice_offline", undefined],
    ["fetch TypeError", new TypeError("fetch failed"), "voice_offline", undefined],
    ["abort timeout", Object.assign(new Error("t"), { name: "TimeoutError" }), "voice_timeout", undefined],
    ["500", new GradiumAPIError("x", 500, {}), "internal", 500],
    ["unknown", new Error("weird"), "internal", undefined],
  ];
  it.each(cases)("maps %s", async (_n, err, code, upstream) => {
    const e = await synthesizeGradium(TEXT, cfg, failing(err)).catch((x) => x);
    expect(e.code).toBe(code);
    expect(e.upstreamStatus).toBe(upstream);
  });

  it("quota is 503 and not retryable", async () => {
    const e = await synthesizeGradium(TEXT, cfg, failing(new GradiumAPIError("x", 402, {}))).catch((x) => x);
    expect([e.status, e.retryable]).toEqual([503, false]);
  });

  it("times out when the client hangs", async () => {
    const e = await synthesizeGradium(TEXT, { ...cfg, timeoutMs: 20 }, fake(() => new Promise(() => {}))).catch((x) => x);
    expect(e.code).toBe("voice_timeout");
  });

  it("rejects empty audio", async () => {
    const e = await synthesizeGradium(TEXT, cfg, fake(async () => ({ rawData: new Uint8Array() }))).catch((x) => x);
    expect(e.code).toBe("internal");
  });

  it("never logs or surfaces text, key or upstream message bodies", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const err = new GradiumAPIError(`bad ${TEXT} ${cfg.apiKey}`, 500, { echo: TEXT });
    const e = await synthesizeGradium(TEXT, cfg, failing(err)).catch((x) => x);
    const seen = JSON.stringify(spies.map((s) => s.mock.calls)) + e.message + JSON.stringify(e);
    expect(seen).not.toContain(TEXT);
    expect(seen).not.toContain(cfg.apiKey);
  });
});

describe("streamGradium", () => {
  async function* words() {
    yield "Hello ";
    yield "there";
  }
  const streamer = (open: GradiumLike["ttsStream"]) => () => ({ tts: () => Promise.reject(new Error("unused")), ttsStream: open });
  const collect = async (g: AsyncGenerator<Uint8Array>) => {
    const out: number[][] = [];
    for await (const c of g) out.push([...c]);
    return out;
  };

  it("opens a pcm stream, yields chunks (skipping empty ones) and closes", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue({
      sampleRate: 24000,
      iterBytes: async function* () {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array();
        yield new Uint8Array([3, 4]);
      },
      close,
    });
    const r = await streamGradium(words(), cfg, { clientFactory: streamer(open) });
    expect(r.sampleRate).toBe(24000);
    expect(await collect(r.chunks)).toEqual([[1, 2], [3, 4]]);
    expect(open.mock.calls[0][0]).toEqual({ voice_id: "voice-1", output_format: "pcm_24000" });
    expect(close).toHaveBeenCalled();
  });

  it("maps open and mid-stream errors", async () => {
    const e1 = await streamGradium(words(), cfg, { clientFactory: streamer(() => Promise.reject(new GradiumAPIError("x", 401, {}))) }).catch((x) => x);
    expect(e1.code).toBe("voice_auth");
    const r = await streamGradium(words(), cfg, {
      clientFactory: streamer(async () => ({
        iterBytes: async function* () {
          yield new Uint8Array([1]);
          throw new GradiumAPIError("x", 429, {});
        },
        close: async () => {},
      })),
    });
    const e2 = await collect(r.chunks).catch((x) => x);
    expect(e2.code).toBe("voice_busy");
  });

  it("times out when the stream stalls", async () => {
    const r = await streamGradium(words(), { ...cfg, timeoutMs: 30 }, {
      clientFactory: streamer(async () => ({ iterBytes: async function* () { await new Promise(() => {}); }, close: async () => {} })),
    });
    const e = await collect(r.chunks).catch((x) => x);
    expect(e.code).toBe("voice_timeout");
  });

  it("passes the abort signal through to the SDK", async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    await streamGradium(words(), cfg, {
      signal: ac.signal,
      clientFactory: streamer(async (_s, _t, o) => {
        seen = o?.signal;
        return { iterBytes: async function* () {}, close: async () => {} };
      }),
    });
    ac.abort();
    expect(seen?.aborted).toBe(true);
  });
});
