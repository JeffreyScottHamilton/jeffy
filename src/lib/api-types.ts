export type ErrorCode = "invalid_request" | "config_missing" | "rate_limited" | "model_error" | "voice_offline" |
  "voice_timeout" | "voice_busy" | "voice_auth" | "voice_config" | "voice_quota" | "unauthorized" | "internal";
export type ChatMode = "text" | "talk";
export type ChatRequest = { question: string; history?: { question: string; reply: string }[]; mode?: ChatMode };
export type ChatErrorBody = { error: { code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number } };
export const MAX_QUESTION_CHARS = 500; export const MAX_HISTORY_TURNS = 8;

/** One JSON object per line (NDJSON) streamed by POST /api/chat. Never carries profile text. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "text_done"; text: string }
  | { type: "audio"; mime: string; data: string }
  /** Raw PCM s16le mono, base64; sent while the reply text is still streaming. */
  | { type: "audio_chunk"; data: string; sampleRate: number }
  | { type: "audio_end" }
  | { type: "audio_error"; code: ErrorCode; message: string; retryable: boolean }
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean };
