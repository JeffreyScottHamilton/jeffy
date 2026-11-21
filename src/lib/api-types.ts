export type ErrorCode = "invalid_request" | "config_missing" | "rate_limited" | "model_error" | "voice_offline" |
  "voice_timeout" | "voice_busy" | "voice_auth" | "voice_config" | "voice_quota" | "internal";
export type ChatMode = "text" | "talk";
export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf" |
  "text/plain" | "text/markdown";
export const ATTACHMENT_MIMES: readonly AttachmentMime[] = ["image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/markdown"];
export type Attachment = { name: string; mime: AttachmentMime; /** base64, no data: prefix */ data: string };
export type HistoryTurn = { question: string; reply: string };
export type ChatRequest = {
  question: string;
  history?: HistoryTurn[];
  mode?: ChatMode;          // default "text"
  voice?: boolean;          // default false; talk mode implies true
  search?: boolean;         // Google Search grounding, default false
  think?: boolean;          // show reasoning (thinkingLevel LOW + includeThoughts), default true; talk => false
  attachments?: Attachment[];
};
export type ChatErrorBody = { error: { code: ErrorCode; message: string; retryable: boolean; retryAfterSeconds?: number } };
export const MAX_QUESTION_CHARS = 4000;
export const MAX_HISTORY_TURNS = 12;
export const MAX_HISTORY_TURN_CHARS = 6000;
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // decoded total
export type SourceRef = { url: string; title: string };

/** NDJSON, one object per line, from POST /api/chat. */
export type ChatEvent =
  | { type: "reasoning"; delta: string }
  | { type: "search"; queries: string[] }          // emitted once when queries first appear
  | { type: "sources"; sources: SourceRef[] }      // emitted once after text completes, deduped by url, max 10
  | { type: "text"; delta: string }                // markdown preserved
  | { type: "text_done"; text: string }            // full markdown reply, trimmed
  | { type: "audio"; mime: string; data: string }
  | { type: "audio_chunk"; data: string; sampleRate: number }
  | { type: "audio_end" }
  | { type: "audio_error"; code: ErrorCode; message: string; retryable: boolean }
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean };
