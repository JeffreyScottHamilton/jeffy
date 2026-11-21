import "server-only";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  type ChatErrorBody,
  type ChatEvent,
  type ChatMode,
  type ErrorCode,
} from "@/lib/api-types";
import { readConfig } from "@/lib/server/config";
import { JeffyError } from "@/lib/server/errors";
import { cleanReply, streamReply } from "@/lib/server/gemini";
import { formatToday, loadProfile, ProfileError, resolveTimeZone, selectRelevant } from "@/lib/server/profile";
import { buildPrompt, type Turn } from "@/lib/server/prompt";
import { streamGradium } from "@/lib/server/gradium";
import { synthesize } from "@/lib/server/voicestudio";
import { TextQueue } from "./text-queue";

export const maxDuration = 60;
// `dynamic` and `runtime` are omitted: both are rejected under cacheComponents (Next 16); nodejs is the default
// and POST handlers are never cached.

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TURN_CHARS = 500;

const MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "Type a question first.",
  config_missing: "Jeffy isn't fully set up yet.",
  rate_limited: "Jeffy is getting too many questions right now. Try again in a moment.",
  model_error: "Jeffy couldn't think of an answer. Try again.",
  voice_offline: "Jeffy's voice service is offline. Try again when it's back.",
  voice_timeout: "Jeffy's voice took too long to answer. Try again.",
  voice_busy: "Jeffy's voice service is busy. Try again in a moment.",
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

// Truncate by code points so a surrogate pair is never split.
const truncate = (s: string) => Array.from(s).slice(0, MAX_TURN_CHARS).join("");

function parseHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns: Turn[] = [];
  for (const t of raw) {
    if (
      t &&
      typeof t === "object" &&
      typeof (t as Turn).question === "string" &&
      typeof (t as Turn).reply === "string"
    ) {
      turns.push({
        question: truncate((t as Turn).question),
        reply: truncate((t as Turn).reply),
      });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

const encoder = new TextEncoder();
const line = (e: ChatEvent) => encoder.encode(`${JSON.stringify(e)}\n`);

// Stream-time cleanup of markdown characters; the final reply goes through cleanReply.
const cleanDelta = (s: string) => s.replace(/[*_#`]/g, "");

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

export async function POST(request: Request): Promise<Response> {
  try {
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
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    if (!obj || typeof obj.question !== "string") return invalid();
    const question = obj.question.trim();
    if (!question) return invalid();
    if (question.length > MAX_QUESTION_CHARS) return invalid(`Keep questions under ${MAX_QUESTION_CHARS} characters.`);
    const history = parseHistory(obj.history);
    if (obj.mode !== undefined && obj.mode !== "text" && obj.mode !== "talk") return invalid();
    const mode: ChatMode = obj.mode === "talk" ? "talk" : "text";

    const cfg = readConfig();
    if (!cfg.ok) {
      const detail = [
        ...(cfg.missing.length ? [`Missing: ${cfg.missing.join(", ")}.`] : []),
        ...cfg.problems.map((p) => `${p}.`),
      ];
      return errorResponse("config_missing", 503, false, {
        message: `Jeffy isn't fully set up yet. ${detail.join(" ")}`.trim(),
      });
    }

    const { profile } = await loadProfile();
    const now = new Date();
    const timeZone = resolveTimeZone();
    const excerpt = selectRelevant(profile, question, history, now, timeZone);
    const prompt = buildPrompt(excerpt, history, question, formatToday(now, timeZone));
    if (mode === "talk") {
      prompt.systemInstruction +=
        "\nThis is a live spoken conversation: answer in one or two short, natural sentences, like talking to a friend.";
    }
    const config = cfg.config;
    let cancelled = false;
    const ctrl = new AbortController();
    const MAX_SPOKEN_CHARS = 600; // matches cleanReply's cap
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: ChatEvent) => {
          if (!cancelled) controller.enqueue(line(e));
        };
        const streaming = config.voiceProvider === "gradium";
        let queue: TextQueue | undefined;
        let voice: Promise<void> | undefined;
        let spoken = 0;

        // Starts on the first answer text so the Gradium deadline does not run while Gemini is still thinking.
        const startVoice = () => {
          const q = (queue = new TextQueue());
          voice = (async () => {
            try {
              const { sampleRate, chunks } = await streamGradium(q, config.gradium, { signal: ctrl.signal });
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

        try {
          let raw = "";
          try {
            for await (const chunk of streamReply(prompt, {
              apiKey: config.geminiApiKey,
              timeoutMs: config.geminiTimeoutMs,
              signal: ctrl.signal,
            })) {
              if (cancelled) return;
              raw += chunk.delta;
              const delta = cleanDelta(chunk.delta);
              if (!delta) continue;
              send({ type: "text", delta });
              if (streaming && spoken < MAX_SPOKEN_CHARS) {
                if (!queue) startVoice();
                const piece = delta.slice(0, MAX_SPOKEN_CHARS - spoken);
                spoken += piece.length;
                queue!.push(piece);
              }
            }
          } catch (e) {
            ctrl.abort();
            queue?.end();
            await voice;
            send({ type: "error", ...failure(e, "model_error") });
            return;
          }
          const reply = cleanReply(raw);
          if (!reply) {
            ctrl.abort();
            queue?.end();
            await voice;
            send({ type: "error", ...failure(null, "model_error") });
            return;
          }
          send({ type: "text_done", text: reply });
          if (streaming) {
            queue?.end();
            await voice;
            return;
          }
          try {
            const { audio, contentType } = await synthesize(reply, config.voicestudio);
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
    if (e instanceof ProfileError) {
      const where =
        e.source === "env"
          ? "JEFFY_PROFILE_JSON"
          : e.source === "file"
            ? "profile/profile.private.json"
            : "the example profile";
      return errorResponse("config_missing", 503, false, {
        message: `Jeffy isn't fully set up yet. ${where} is invalid.`,
      });
    }
    return errorResponse("internal", 500, true);
  }
}
