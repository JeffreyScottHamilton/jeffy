import "server-only";
import {
  ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_HISTORY_TURN_CHARS,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  type Attachment,
  type AttachmentMime,
  type ChatErrorBody,
  type ChatEvent,
  type ChatMode,
  type ErrorCode,
  type HistoryTurn,
  type SourceRef,
} from "@/lib/api-types";
import { readConfig, type VoiceConfigResult } from "@/lib/server/config";
import { JeffyError } from "@/lib/server/errors";
import { cleanReply, streamReply } from "@/lib/server/gemini";
import { buildPrompt } from "@/lib/server/prompt";
import { SpeechFilter, toSpeech } from "@/lib/server/speakable";
import { streamGradium } from "@/lib/server/gradium";
import { formatToday, resolveTimeZone } from "@/lib/server/time";
import { synthesize } from "@/lib/server/voicestudio";
import { TextQueue } from "./text-queue";

export const maxDuration = 60;
// `dynamic` and `runtime` are omitted: both are rejected under cacheComponents (Next 16); nodejs is the default
// and POST handlers are never cached.

/** Vercel caps request bodies at 4.5 MB; stay just under it. */
const MAX_BODY_BYTES = Math.floor(4.4 * 1024 * 1024);
const MAX_ATTACHMENT_NAME_CHARS = 200;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "Type a message first.",
  config_missing: "Jeffy isn't fully set up yet.",
  rate_limited: "Jeffy is getting too many requests right now. Try again in a moment.",
  model_error: "Jeffy couldn't come up with an answer. Try again.",
  voice_offline: "The voice service is offline. Try again when it's back.",
  voice_timeout: "The voice took too long to answer. Try again.",
  voice_busy: "The voice service is busy. Try again in a moment.",
  voice_auth: "The voice service rejected Jeffy's credentials. Check the voice API key or token.",
  voice_config: "Jeffy's voice isn't set up correctly. Check the voice id (GRADIUM_VOICE_ID or VOICESTUDIO_VOICE_ID).",
  voice_quota: "The free voice allowance is used up for this month.",
  internal: "Something went wrong. Try again.",
};

function errorResponse(
  code: ErrorCode,
  status: number,
  retryable: boolean,
  opts: { message?: string; retryAfterSeconds?: number; upstreamStatus?: number } = {},
): Response {
  const body: ChatErrorBody = {
    error: {
      code,
      message: opts.message ?? MESSAGES[code],
      retryable,
      ...(opts.retryAfterSeconds ? { retryAfterSeconds: opts.retryAfterSeconds } : {}),
    },
  };
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (opts.retryAfterSeconds) headers["Retry-After"] = String(opts.retryAfterSeconds);
  if (status >= 500 || code === "rate_limited") {
    console.error("[jeffy] chat failed", {
      code,
      status,
      ...(opts.upstreamStatus ? { upstreamStatus: opts.upstreamStatus } : {}),
    });
  }
  return Response.json(body, { status, headers });
}

const invalid = (message?: string) => errorResponse("invalid_request", 400, false, { message });

class Invalid extends Error {}

// Truncate by code points so a surrogate pair is never split.
const truncate = (s: string) =>
  s.length <= MAX_HISTORY_TURN_CHARS ? s : Array.from(s).slice(0, MAX_HISTORY_TURN_CHARS).join("");

function parseHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: HistoryTurn[] = [];
  for (const t of raw) {
    const o = t as Partial<HistoryTurn> | null;
    if (o && typeof o === "object" && typeof o.question === "string" && typeof o.reply === "string") {
      turns.push({ question: truncate(o.question), reply: truncate(o.reply) });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

function decodedBytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

function parseAttachments(raw: unknown): Attachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Invalid("Attachments must be a list.");
  if (raw.length > MAX_ATTACHMENTS) throw new Invalid(`Attach at most ${MAX_ATTACHMENTS} files.`);
  let total = 0;
  return raw.map((a): Attachment => {
    const o = a as Record<string, unknown> | null;
    if (!o || typeof o !== "object") throw new Invalid("That attachment is invalid.");
    const { name, mime, data } = o;
    if (typeof name !== "string" || !name.trim() || name.length > MAX_ATTACHMENT_NAME_CHARS) {
      throw new Invalid(`Attachment names must be 1-${MAX_ATTACHMENT_NAME_CHARS} characters.`);
    }
    if (typeof mime !== "string" || !ATTACHMENT_MIMES.includes(mime as AttachmentMime)) {
      throw new Invalid("Attach images (PNG, JPEG, WebP, GIF), PDFs, or plain text / markdown files.");
    }
    if (typeof data !== "string" || !data || data.length % 4 !== 0 || !BASE64.test(data)) {
      throw new Invalid("That attachment could not be read.");
    }
    total += decodedBytes(data);
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new Invalid(`Attachments must total ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB or less.`);
    }
    return { name: name.trim(), mime: mime as AttachmentMime, data };
  });
}

function optionalBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Invalid();
  return v;
}

const encoder = new TextEncoder();
const line = (e: ChatEvent) => encoder.encode(`${JSON.stringify(e)}\n`);

function failure(e: unknown, fallback: ErrorCode): { code: ErrorCode; message: string; retryable: boolean } {
  if (e instanceof JeffyError) {
    const message =
      e.code === "config_missing" ? "The Gemini key was rejected. Check GOOGLE_GENERATIVE_AI_API_KEY." : MESSAGES[e.code];
    console.error("[jeffy] chat stream failed", {
      code: e.code,
      ...(e.upstreamStatus ? { upstreamStatus: e.upstreamStatus } : {}),
    });
    return { code: e.code, message, retryable: e.retryable };
  }
  console.error("[jeffy] chat stream failed", { code: fallback });
  return { code: fallback, message: MESSAGES[fallback], retryable: true };
}

function voiceConfigFailure(v: Extract<VoiceConfigResult, { ok: false }>): ChatEvent {
  const detail = [...(v.missing.length ? [`Missing: ${v.missing.join(", ")}.`] : []), ...v.problems.map((p) => `${p}.`)];
  console.error("[jeffy] voice not configured", { code: "voice_config" });
  return {
    type: "audio_error",
    code: "voice_config",
    message: `Jeffy's voice isn't set up. ${detail.join(" ")}`.trim(),
    retryable: false,
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return invalid("That request is too large.");
    let text: string;
    try {
      text = await request.text();
    } catch {
      return invalid();
    }
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return invalid("That request is too large.");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return invalid();
    }
    const obj = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    if (!obj || typeof obj.question !== "string") return invalid();
    const question = obj.question.trim();
    if (!question) return invalid();
    if (question.length > MAX_QUESTION_CHARS) return invalid(`Keep messages under ${MAX_QUESTION_CHARS} characters.`);
    if (obj.mode !== undefined && obj.mode !== "text" && obj.mode !== "talk") return invalid();
    const mode: ChatMode = obj.mode === "talk" ? "talk" : "text";
    let attachments: Attachment[];
    let wantsVoice: boolean;
    let search: boolean;
    let think: boolean;
    try {
      attachments = parseAttachments(obj.attachments);
      wantsVoice = mode === "talk" || optionalBool(obj.voice) === true;
      search = optionalBool(obj.search) ?? false;
      const thinkOpt = optionalBool(obj.think);
      think = mode === "talk" ? false : (thinkOpt ?? true);
    } catch (e) {
      if (e instanceof Invalid) return invalid(e.message || undefined);
      throw e;
    }
    const history = parseHistory(obj.history);

    const cfg = readConfig();
    if (!cfg.ok) {
      return errorResponse("config_missing", 503, false, {
        message: `Jeffy isn't fully set up yet. Missing: ${cfg.missing.join(", ")}.`,
      });
    }
    const config = cfg.config;
    const voiceCfg = wantsVoice ? config.voice : undefined;

    const now = new Date();
    const prompt = buildPrompt({
      question,
      history,
      attachments,
      today: formatToday(now, resolveTimeZone()),
      mode,
    });
    let cancelled = false;
    const ctrl = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: ChatEvent) => {
          if (!cancelled) controller.enqueue(line(e));
        };
        const voice = voiceCfg?.ok ? voiceCfg.config : undefined;
        const streaming = voice?.provider === "gradium";
        const speech = new SpeechFilter();
        let queue: TextQueue | undefined;
        let voiceTask: Promise<void> | undefined;

        // Starts on the first speakable text so the Gradium deadline does not run while Gemini is still thinking.
        const startVoice = () => {
          const q = (queue = new TextQueue());
          voiceTask = (async () => {
            try {
              const { sampleRate, chunks } = await streamGradium(q, voice!.gradium, { signal: ctrl.signal });
              let any = false;
              for await (const c of chunks) {
                if (cancelled || ctrl.signal.aborted) return;
                any = true;
                send({ type: "audio_chunk", data: Buffer.from(c).toString("base64"), sampleRate });
              }
              if (cancelled || ctrl.signal.aborted) return;
              if (!any) throw new JeffyError("internal", 502, true, "Voice service returned empty audio");
              send({ type: "audio_end" });
            } catch (e) {
              if (!cancelled && !ctrl.signal.aborted) send({ type: "audio_error", ...failure(e, "internal") });
            }
          })();
        };
        const speak = (piece: string) => {
          if (!streaming || !piece) return;
          if (!queue) startVoice();
          queue!.push(piece);
        };
        const stopVoice = async () => {
          ctrl.abort();
          queue?.end();
          await voiceTask;
        };

        try {
          let raw = "";
          let sources: SourceRef[] | undefined;
          try {
            for await (const chunk of streamReply(prompt, {
              apiKey: config.geminiApiKey,
              timeoutMs: config.geminiTimeoutMs,
              signal: ctrl.signal,
              think,
              search,
            })) {
              if (cancelled) return;
              if (chunk.kind === "reasoning") {
                if (chunk.delta) send({ type: "reasoning", delta: chunk.delta });
              } else if (chunk.kind === "search") {
                send({ type: "search", queries: chunk.queries });
              } else if (chunk.kind === "sources") {
                sources = chunk.sources;
              } else if (chunk.delta) {
                raw += chunk.delta;
                send({ type: "text", delta: chunk.delta });
                speak(speech.push(chunk.delta));
              }
            }
          } catch (e) {
            await stopVoice();
            send({ type: "error", ...failure(e, "model_error") });
            return;
          }
          const reply = cleanReply(raw);
          if (!reply) {
            await stopVoice();
            send({ type: "error", ...failure(null, "model_error") });
            return;
          }
          send({ type: "text_done", text: reply });
          if (sources?.length) send({ type: "sources", sources });
          if (!voiceCfg) return;
          if (!voiceCfg.ok) {
            send(voiceConfigFailure(voiceCfg));
            return;
          }
          if (streaming) {
            speak(speech.end());
            queue?.end();
            await voiceTask;
            return;
          }
          const spoken = toSpeech(reply);
          if (!spoken) return;
          try {
            const { audio, contentType } = await synthesize(spoken, voice!.voicestudio);
            send({ type: "audio", mime: contentType, data: Buffer.from(audio).toString("base64") });
          } catch (e) {
            send({ type: "audio_error", ...failure(e, "internal") });
          }
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        ctrl.abort();
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof JeffyError) {
      let message: string | undefined;
      if (e.code === "config_missing") message = "The Gemini key was rejected. Check GOOGLE_GENERATIVE_AI_API_KEY.";
      return errorResponse(e.code, e.status, e.retryable, {
        message,
        retryAfterSeconds: e.retryAfterSeconds ?? (e.code === "rate_limited" ? 10 : undefined),
        upstreamStatus: e.upstreamStatus,
      });
    }
    return errorResponse("internal", 500, true);
  }
}
