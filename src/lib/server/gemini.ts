import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel, type GroundingMetadata } from "@google/genai";
import type { SourceRef } from "@/lib/api-types";
import { ModelAuthError, ModelError, ModelTimeoutError, RateLimitError } from "./errors";
import type { Prompt } from "./prompt";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_OUTPUT_TOKENS = 8192; // thinking tokens count against this budget
export const MAX_REPLY_CHARS = 20000;
export const MAX_SOURCES = 10;

/** Trims the reply and caps its size (by code points). Markdown is preserved. */
export function cleanReply(text: string): string {
  const t = text.trim();
  return t.length <= MAX_REPLY_CHARS ? t : Array.from(t).slice(0, MAX_REPLY_CHARS).join("").trim();
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

export type ReplyChunk =
  | { kind: "reasoning"; delta: string }
  | { kind: "text"; delta: string }
  | { kind: "search"; queries: string[] }
  | { kind: "sources"; sources: SourceRef[] };

/** Adds grounding sources to `into` (keyed by url), keeping only http(s) links, at most MAX_SOURCES. */
export function collectSources(meta: GroundingMetadata | undefined, into: Map<string, SourceRef>): void {
  for (const chunk of meta?.groundingChunks ?? []) {
    if (into.size >= MAX_SOURCES) return;
    const web = chunk.web;
    if (!web?.uri || into.has(web.uri)) continue;
    let host: string;
    try {
      const u = new URL(web.uri);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      host = u.hostname;
    } catch {
      continue;
    }
    const title = web.title?.trim() || web.domain?.trim() || host;
    into.set(web.uri, { url: web.uri, title });
  }
}

/** Streams reasoning, search queries, answer text and finally sources. Throws a JeffyError subclass on failure. */
export async function* streamReply(
  prompt: Prompt,
  {
    apiKey,
    timeoutMs,
    signal,
    think = false,
    search = false,
  }: { apiKey: string; timeoutMs: number; signal?: AbortSignal; think?: boolean; search?: boolean },
): AsyncGenerator<ReplyChunk> {
  const ai = new GoogleGenAI({ apiKey });
  const sources = new Map<string, SourceRef>();
  let searched = false;
  try {
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt.contents,
      config: {
        systemInstruction: prompt.systemInstruction,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        thinkingConfig: think
          ? { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true }
          : { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false },
        ...(search ? { tools: [{ googleSearch: {} }] } : {}),
        abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      },
    });
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      const meta = candidate?.groundingMetadata;
      const queries = (meta?.webSearchQueries ?? []).filter((q) => typeof q === "string" && q.trim());
      if (!searched && queries.length) {
        searched = true;
        yield { kind: "search", queries };
      }
      collectSources(meta, sources);
      for (const part of candidate?.content?.parts ?? []) {
        if (!part.text) continue;
        if (part.thought === true) {
          if (think) yield { kind: "reasoning", delta: part.text };
        } else {
          yield { kind: "text", delta: part.text };
        }
      }
    }
  } catch (e) {
    throw mapError(e);
  }
  if (sources.size) yield { kind: "sources", sources: [...sources.values()] };
}
