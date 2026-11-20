import "server-only";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  REPLY_HEADER,
  type ChatErrorBody,
  type ErrorCode,
} from "@/lib/api-types";
import { readConfig } from "@/lib/server/config";
import { JeffyError } from "@/lib/server/errors";
import { generateReply } from "@/lib/server/gemini";
import { loadProfile, ProfileError, selectRelevant } from "@/lib/server/profile";
import { buildPrompt, type Turn } from "@/lib/server/prompt";
import { synthesizeGradium } from "@/lib/server/gradium";
import { synthesize } from "@/lib/server/voicestudio";

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

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
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
    if (question.length > MAX_QUESTION_CHARS) return invalid("Keep questions under 500 characters.");
    const history = parseHistory(obj.history);

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
    const excerpt = selectRelevant(profile, question, history);
    const prompt = buildPrompt(excerpt, history, question);
    const reply = await generateReply(prompt, {
      apiKey: cfg.config.geminiApiKey,
      timeoutMs: cfg.config.geminiTimeoutMs,
    });
    const { audio, contentType } =
      cfg.config.voiceProvider === "gradium"
        ? await synthesizeGradium(reply, cfg.config.gradium)
        : await synthesize(reply, cfg.config.voicestudio);

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        [REPLY_HEADER]: toBase64Url(reply),
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
