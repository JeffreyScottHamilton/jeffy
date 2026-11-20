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

export async function generateReply(
  prompt: Prompt,
  { apiKey, timeoutMs }: { apiKey: string; timeoutMs: number },
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt.contents,
      config: {
        systemInstruction: prompt.systemInstruction,
        maxOutputTokens: 200,
        temperature: 0.6,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    text = res.text;
  } catch (e) {
    throw mapError(e);
  }
  const out = cleanReply(text ?? "");
  if (!out) throw new ModelError("Model returned no text");
  return out;
}
