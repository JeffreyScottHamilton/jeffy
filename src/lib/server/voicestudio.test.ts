import { describe, expect, it, vi } from "vitest";
import type { VoiceStudioConfig } from "./config";
import {
  VoiceAuthError,
  VoiceBusyError,
  VoiceConfigError,
  VoiceOfflineError,
  VoiceTimeoutError,
  VoiceUpstreamError,
} from "./errors";
import { synthesize } from "./voicestudio";

const TOKEN = "tok-SECRET-123";
const cfg: VoiceStudioConfig = {
  baseUrl: "https://voice.example.com",
  voiceId: "alloy",
  authToken: TOKEN,
  responseFormat: "wav",
  timeoutMs: 1000,
};
const f = (impl: () => Promise<Response> | Response) => vi.fn(async () => impl()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

async function fail(fetchImpl: typeof fetch, text = "reply text private") {
  try {
    await synthesize(text, cfg, fetchImpl);
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected failure");
}

describe("synthesize", () => {
  it("returns audio and sends bearer + JSON body", async () => {
    const fetchImpl = f(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/wav" } }));
    const r = await synthesize("hello", { ...cfg, model: "m1" }, fetchImpl);
    expect(r.contentType).toBe("audio/wav");
    expect(new Uint8Array(r.audio)).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://voice.example.com/v1/audio/speech");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ input: "hello", voice: "alloy", response_format: "wav", model: "m1" });
  });
  it("omits Authorization and model when unset", async () => {
    const fetchImpl = f(() => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/x-wav" } }));
    await synthesize("hi", { ...cfg, authToken: undefined }, fetchImpl);
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).not.toHaveProperty("model");
  });
  it("ECONNREFUSED -> VoiceOfflineError", async () => {
    const err = await fail(f(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }));
    expect(err).toBeInstanceOf(VoiceOfflineError);
  });
  it("timeout -> VoiceTimeoutError", async () => {
    const err = await fail(f(() => { throw new DOMException("timed out", "TimeoutError"); }));
    expect(err).toBeInstanceOf(VoiceTimeoutError);
  });
  it("503 + Retry-After -> VoiceBusyError", async () => {
    const err = (await fail(f(() => new Response("busy", { status: 503, headers: { "retry-after": "7" } })))) as VoiceBusyError;
    expect(err).toBeInstanceOf(VoiceBusyError);
    expect(err.retryAfterSeconds).toBe(7);
  });
  it("maps auth, config, gateway and other statuses", async () => {
    const st = (s: number) => fail(f(() => new Response("x", { status: s })));
    expect(await st(401)).toBeInstanceOf(VoiceAuthError);
    expect(await st(403)).toBeInstanceOf(VoiceAuthError);
    expect(await st(404)).toBeInstanceOf(VoiceConfigError);
    expect(await st(422)).toBeInstanceOf(VoiceConfigError);
    expect(await st(502)).toBeInstanceOf(VoiceOfflineError);
    expect(await st(504)).toBeInstanceOf(VoiceTimeoutError);
    expect(await st(500)).toBeInstanceOf(VoiceUpstreamError);
  });
  it("non-audio or empty body -> VoiceUpstreamError", async () => {
    expect(await fail(f(() => new Response("{}", { headers: { "content-type": "application/json" } })))).toBeInstanceOf(VoiceUpstreamError);
    expect(await fail(f(() => new Response(new Uint8Array(0), { headers: { "content-type": "audio/wav" } })))).toBeInstanceOf(VoiceUpstreamError);
  });
  it("error messages never contain token or reply text", async () => {
    const impls = [
      () => new Response(`${TOKEN} reply text private`, { status: 401 }),
      () => new Response("x", { status: 503 }),
      () => new Response("x", { status: 500 }),
      () => { throw new TypeError(`failed ${TOKEN}`); },
      () => new Response("x", { headers: { "content-type": "text/plain" } }),
    ];
    for (const i of impls) {
      const err = await fail(f(i));
      expect(err.message).not.toContain(TOKEN);
      expect(err.message).not.toContain("reply text private");
    }
  });
});
