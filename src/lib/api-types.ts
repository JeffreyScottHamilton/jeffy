export type ErrorCode = "invalid_request" | "config_missing" | "rate_limited" | "model_error" | "voice_offline" |
  "voice_timeout" | "voice_busy" | "voice_auth" | "voice_config" | "voice_quota" | "internal";
export type ChatRequest = { question: string; history?: { question: string; reply: string }[] };
export type ChatErrorBody = { error: { code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number } };
export const MAX_QUESTION_CHARS = 500; export const MAX_HISTORY_TURNS = 4; export const REPLY_HEADER = "x-jeffy-reply";
