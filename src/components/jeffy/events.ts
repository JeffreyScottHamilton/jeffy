import type { ChatEvent, SourceRef } from "@/lib/api-types";
import type { Turn } from "./types";

export const GENERIC_MSG = "Something went wrong. Try again.";
export const NO_VOICE_MSG = "The voice didn't arrive. Try again.";

export type ApplyContext = {
  /** Time the event was received (ms). */
  now: number;
  /** When the first reasoning delta of this turn arrived, if any. */
  reasoningStartedAt?: number;
  /** Whether this request asked for a spoken reply. */
  voice: boolean;
};

const EVENT_TYPES = new Set<ChatEvent["type"]>([
  "reasoning",
  "search",
  "sources",
  "text",
  "text_done",
  "audio",
  "audio_chunk",
  "audio_end",
  "audio_error",
  "error",
]);

function mergeQueries(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const q of b) {
    const s = typeof q === "string" ? q.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function mergeSources(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const out = [...a];
  for (const s of b) {
    if (!s || typeof s.url !== "string" || !s.url) continue;
    if (!out.some((x) => x.url === s.url)) out.push({ url: s.url, title: s.title || s.url });
  }
  return out;
}

function withReasoningTime(t: Turn, ctx: ApplyContext): Turn {
  if (t.reasoningMs !== undefined || !t.reasoning || ctx.reasoningStartedAt === undefined) return t;
  return { ...t, reasoningMs: Math.max(0, ctx.now - ctx.reasoningStartedAt) };
}

/** Pure reducer: applies one server event to a turn. Audio side effects live in the chat runner. */
export function applyEvent(t: Turn, ev: ChatEvent, ctx: ApplyContext): Turn {
  switch (ev.type) {
    case "reasoning":
      return { ...t, reasoning: t.reasoning + ev.delta };
    case "search":
      return { ...t, searchQueries: mergeQueries(t.searchQueries, ev.queries ?? []) };
    case "sources":
      return { ...t, sources: mergeSources(t.sources, ev.sources ?? []) };
    case "text":
      return withReasoningTime({ ...t, text: t.text + ev.delta }, ctx);
    case "text_done":
      return withReasoningTime(
        {
          ...t,
          status: "done",
          text: ev.text,
          final: ev.text,
          voice: ctx.voice && t.voice.status === "none" ? { status: "pending" } : t.voice,
        },
        ctx,
      );
    case "audio_chunk":
      return t.voice.status === "live" ? t : { ...t, voice: { status: "live" } };
    case "audio":
    case "audio_end":
      return t;
    case "audio_error":
      return t.voice.status === "live" ? t : { ...t, voice: { status: "error", message: ev.message } };
    case "error":
      return withReasoningTime(
        { ...t, status: "error", error: { message: ev.message, retryable: ev.retryable } },
        ctx,
      );
  }
}

/** Called once the response body has closed without an abort. */
export function endOfStream(t: Turn, voiceRequested: boolean): Turn {
  if (t.status === "streaming") {
    return { ...t, status: "error", error: { message: GENERIC_MSG, retryable: true } };
  }
  // The server sends no audio at all when nothing in the reply is speakable (e.g. code only).
  if (voiceRequested && t.voice.status === "pending") return { ...t, voice: { status: "none" } };
  return t;
}

/** The user pressed Stop: keep what arrived. */
export function stopTurn(t: Turn): Turn {
  const voice = t.voice.status === "pending" || t.voice.status === "live" ? { status: "none" as const } : t.voice;
  if (t.status === "streaming") return { ...t, status: "stopped", voice };
  return { ...t, voice };
}

/** Line-buffered NDJSON parser; malformed lines and unknown event types are skipped. */
export function createNdjsonParser(onEvent: (ev: ChatEvent) => void) {
  let buf = "";
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    let ev: unknown;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return;
    const type = (ev as { type?: unknown }).type;
    if (typeof type !== "string" || !EVENT_TYPES.has(type as ChatEvent["type"])) return;
    onEvent(ev as ChatEvent);
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    },
    flush() {
      handle(buf);
      buf = "";
    },
  };
}
