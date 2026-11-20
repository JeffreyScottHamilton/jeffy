import { afterEach, describe, expect, it, vi } from "vitest";
import { GradiumAPIError, GradiumWebSocketError } from "@gradium/sdk";
import { synthesizeGradium, type GradiumLike } from "./gradium";

const cfg = { apiKey: "gsk-SECRET-KEY", voiceId: "voice-1", timeoutMs: 1000 };
const TEXT = "private reply text";
const fake = (impl: GradiumLike["tts"]) => () => ({ tts: impl });
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
