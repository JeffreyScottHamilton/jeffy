import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ModelAuthError, ModelError, ModelTimeoutError, RateLimitError } from "./errors";
import type { buildPrompt } from "./prompt";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";

type Prompt = ReturnType<typeof buildPrompt>;

export function cleanReply(text: string): string {
  return text.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim().slice(0, 600).trim();
}

function mapError(e: unknown): Error {
  if (e instanceof ApiError) {
    const s = e.status;
    if (s === 429) return new RateLimitError({ upstreamStatus: s });
    if (s === 401 || s === 403) return new ModelAuthError({ upstreamStatus: s });
    if (s === 400 && /api key|API_KEY_INVALID/i.test(e.message)) return new ModelAuthError({ upstreamStatus: s });
    if (s === 408 || s === 504) return new ModelTimeoutError({ upstreamStatus: s });
    return new ModelError("Model request failed", { upstreamStatus: s });
  }
  const name = (e as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return new ModelTimeoutError();
  return new ModelError("Model request failed");
}

export type ReplyChunk = { kind: "reasoning" | "text"; delta: string };

export const MAX_OUTPUT_TOKENS = 1024; // thinking tokens count against this budget

/** Streams thought summaries and answer text. Throws a JeffyError subclass on failure. */
export async function* streamReply(
  prompt: Prompt,
  { apiKey, timeoutMs }: { apiKey: string; timeoutMs: number },
): AsyncGenerator<ReplyChunk> {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt.contents,
      config: {
        systemInstruction: prompt.systemInstruction,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.6,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true },
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (!part.text) continue;
        yield { kind: part.thought === true ? "reasoning" : "text", delta: part.text };
      }
    }
  } catch (e) {
    throw mapError(e);
  }
}
