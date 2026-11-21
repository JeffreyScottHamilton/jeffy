import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@/lib/api-types";
import { applyEvent, createNdjsonParser, endOfStream, stopTurn } from "./events";
import { newTurn, type Turn } from "./types";

const base = (): Turn => ({ ...newTurn("t1", "Hi"), startedAt: 1000 });
const ctx = (now: number, extra: Partial<{ reasoningStartedAt: number; voice: boolean }> = {}) => ({
  now,
  voice: false,
  ...extra,
});

describe("applyEvent", () => {
  it("appends reasoning deltas", () => {
    let t = applyEvent(base(), { type: "reasoning", delta: "**Plan**\n\n" }, ctx(1100));
    t = applyEvent(t, { type: "reasoning", delta: "Look it up." }, ctx(1200));
    expect(t.reasoning).toBe("**Plan**\n\nLook it up.");
    expect(t.reasoningMs).toBeUndefined();
  });

  it("merges search queries without duplicates", () => {
    let t = applyEvent(base(), { type: "search", queries: ["a", "b"] }, ctx(1));
    t = applyEvent(t, { type: "search", queries: ["b", "c", " "] }, ctx(2));
    expect(t.searchQueries).toEqual(["a", "b", "c"]);
  });

  it("merges sources deduped by url", () => {
    let t = applyEvent(base(), { type: "sources", sources: [{ url: "https://a.com", title: "A" }] }, ctx(1));
    t = applyEvent(
      t,
      {
        type: "sources",
        sources: [
          { url: "https://a.com", title: "A again" },
          { url: "https://b.com", title: "B" },
        ],
      },
      ctx(2),
    );
    expect(t.sources).toEqual([
      { url: "https://a.com", title: "A" },
      { url: "https://b.com", title: "B" },
    ]);
  });

  it("appends text and measures reasoning time from first reasoning to first text", () => {
    let t = applyEvent(base(), { type: "reasoning", delta: "hmm" }, ctx(1000, { reasoningStartedAt: 1000 }));
    t = applyEvent(t, { type: "text", delta: "Hel" }, ctx(4200, { reasoningStartedAt: 1000 }));
    t = applyEvent(t, { type: "text", delta: "lo" }, ctx(9000, { reasoningStartedAt: 1000 }));
    expect(t.text).toBe("Hello");
    expect(t.reasoningMs).toBe(3200);
    expect(t.status).toBe("streaming");
  });

  it("does not set reasoningMs without reasoning", () => {
    const t = applyEvent(base(), { type: "text", delta: "x" }, ctx(5000));
    expect(t.reasoningMs).toBeUndefined();
  });

  it("text_done finalizes the reply and marks voice pending only when voice was requested", () => {
    const t = applyEvent(base(), { type: "text_done", text: "Final" }, ctx(1));
    expect(t).toMatchObject({ status: "done", text: "Final", final: "Final", voice: { status: "none" } });
    const v = applyEvent(base(), { type: "text_done", text: "Final" }, ctx(1, { voice: true }));
    expect(v.voice).toEqual({ status: "pending" });
  });

  it("text_done keeps a live voice", () => {
    const live: Turn = { ...base(), voice: { status: "live" } };
    expect(applyEvent(live, { type: "text_done", text: "x" }, ctx(1, { voice: true })).voice).toEqual({
      status: "live",
    });
  });

  it("audio_chunk switches voice to live; audio and audio_end leave the turn alone", () => {
    const t = applyEvent(base(), { type: "audio_chunk", data: "AAAA", sampleRate: 48000 }, ctx(1));
    expect(t.voice).toEqual({ status: "live" });
    const b = base();
    expect(applyEvent(b, { type: "audio", mime: "audio/wav", data: "AAAA" }, ctx(1))).toBe(b);
    expect(applyEvent(b, { type: "audio_end" }, ctx(1))).toBe(b);
  });

  it("audio_error sets a voice error unless the voice is live", () => {
    const ev: ChatEvent = { type: "audio_error", code: "voice_offline", message: "Voice is offline", retryable: true };
    expect(applyEvent(base(), ev, ctx(1)).voice).toEqual({ status: "error", message: "Voice is offline" });
    const live: Turn = { ...base(), voice: { status: "live" } };
    expect(applyEvent(live, ev, ctx(1)).voice).toEqual({ status: "live" });
  });

  it("error marks the turn as failed with retry info", () => {
    const t = applyEvent(
      base(),
      { type: "error", code: "rate_limited", message: "Slow down", retryable: true },
      ctx(1),
    );
    expect(t.status).toBe("error");
    expect(t.error).toEqual({ message: "Slow down", retryable: true });
  });
});

describe("endOfStream / stopTurn", () => {
  it("fails a turn that never finished", () => {
    const t = endOfStream(base(), false);
    expect(t.status).toBe("error");
    expect(t.error?.retryable).toBe(true);
  });

  it("clears a pending voice when the stream ends without audio (nothing speakable)", () => {
    const done = applyEvent(base(), { type: "text_done", text: "x" }, ctx(1, { voice: true }));
    expect(endOfStream(done, true).voice).toEqual({ status: "none" });
    const late = applyEvent(done, { type: "audio_error", code: "voice_config", message: "No voice", retryable: false }, ctx(2));
    expect(endOfStream(late, true).voice).toEqual({ status: "error", message: "No voice" });
    const plain = applyEvent(base(), { type: "text_done", text: "x" }, ctx(1));
    expect(endOfStream(plain, false)).toBe(plain);
  });

  it("stopTurn keeps partial text and clears pending voice", () => {
    const t = stopTurn({ ...base(), text: "partial" });
    expect(t.status).toBe("stopped");
    expect(t.text).toBe("partial");
    const done = stopTurn({ ...base(), status: "done", final: "x", text: "x", voice: { status: "pending" } });
    expect(done.status).toBe("done");
    expect(done.voice).toEqual({ status: "none" });
  });
});

describe("createNdjsonParser", () => {
  it("parses events split across chunks and skips junk lines", () => {
    const got: ChatEvent[] = [];
    const p = createNdjsonParser((e) => got.push(e));
    p.push('{"type":"reasoning","delta":"a"}\n{"type":"te');
    p.push('xt","delta":"b"}\n\nnot json\n');
    p.push('{"type":"text_done","text":"b"}');
    p.flush();
    expect(got).toEqual([
      { type: "reasoning", delta: "a" },
      { type: "text", delta: "b" },
      { type: "text_done", text: "b" },
    ]);
  });

  it("ignores objects without a known type", () => {
    const got: ChatEvent[] = [];
    const p = createNdjsonParser((e) => got.push(e));
    p.push('{"type":"nope"}\n[1]\n"str"\n');
    p.flush();
    expect(got).toEqual([]);
  });
});
