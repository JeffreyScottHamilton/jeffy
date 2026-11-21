import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContentStream = vi.fn();
vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContentStream };
    },
  };
});

import { ApiError } from "@google/genai";
import { ModelTimeoutError } from "./errors";
import { cleanReply, collectSources, MAX_SOURCES, streamReply, type ReplyChunk } from "./gemini";

const prompt = { systemInstruction: "sys", contents: [{ role: "user" as const, parts: [{ text: "q" }] }] };
type FakeChunk = { parts?: { text?: string; thought?: boolean }[]; meta?: unknown };
function respond(chunks: FakeChunk[]) {
  generateContentStream.mockImplementation(async () =>
    (async function* () {
      for (const c of chunks) {
        yield { candidates: [{ content: { parts: c.parts ?? [] }, groundingMetadata: c.meta }] };
      }
    })(),
  );
}
async function collect(opts: { think?: boolean; search?: boolean } = {}) {
  const out: ReplyChunk[] = [];
  for await (const c of streamReply(prompt, { apiKey: "k", timeoutMs: 1000, ...opts })) out.push(c);
  return out;
}

beforeEach(() => generateContentStream.mockReset());
// The stream opens, then fails while being read (how the SDK surfaces most upstream errors).
const fail = (e: unknown) =>
  generateContentStream.mockImplementation(async () => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(e) }),
  }));

describe("streamReply", () => {
  it("streams reasoning, search queries once, text, then deduped sources", async () => {
    respond([
      { parts: [{ text: "Thinking about it", thought: true }] },
      { parts: [{ text: "Hello " }], meta: { webSearchQueries: ["weather denver"] } },
      {
        parts: [{ text: "world" }],
        meta: {
          webSearchQueries: ["weather denver", "more"],
          groundingChunks: [
            { web: { uri: "https://a.example/x", title: "A" } },
            { web: { uri: "https://a.example/x", title: "dup" } },
            { web: { uri: "https://b.example/y" } },
            { web: { uri: "javascript:alert(1)", title: "bad" } },
            { web: { uri: "https://c.example/z", domain: "c.example" } },
          ],
        },
      },
    ]);
    expect(await collect({ think: true, search: true })).toEqual([
      { kind: "reasoning", delta: "Thinking about it" },
      { kind: "search", queries: ["weather denver"] },
      { kind: "text", delta: "Hello " },
      { kind: "text", delta: "world" },
      {
        kind: "sources",
        sources: [
          { url: "https://a.example/x", title: "A" },
          { url: "https://b.example/y", title: "b.example" },
          { url: "https://c.example/z", title: "c.example" },
        ],
      },
    ]);
    const config = generateContentStream.mock.calls[0][0].config;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "LOW", includeThoughts: true });
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    expect(config.maxOutputTokens).toBe(8192);
    expect(config.temperature).toBe(0.7);
  });
  it("uses minimal thinking, no tools and drops thoughts when think and search are off", async () => {
    respond([{ parts: [{ text: "hidden", thought: true }, { text: "Answer" }] }]);
    expect(await collect()).toEqual([{ kind: "text", delta: "Answer" }]);
    const config = generateContentStream.mock.calls[0][0].config;
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL", includeThoughts: false });
    expect(config.tools).toBeUndefined();
  });
  it("maps API errors", async () => {
    fail(new ApiError({ message: "slow down", status: 429 }));
    await expect(collect()).rejects.toMatchObject({ code: "rate_limited" });
    fail(new ApiError({ message: "API_KEY_INVALID", status: 400 }));
    await expect(collect()).rejects.toMatchObject({ code: "config_missing" });
  });
  it("maps timeouts", async () => {
    fail(new ApiError({ message: "deadline", status: 504 }));
    let caught: unknown;
    try {
      await collect();
    } catch (x) {
      caught = x;
    }
    expect(caught).toBeInstanceOf(ModelTimeoutError);
  });
});

describe("collectSources", () => {
  it("caps at MAX_SOURCES", () => {
    const into = new Map();
    collectSources(
      { groundingChunks: Array.from({ length: 15 }, (_, i) => ({ web: { uri: `https://s${i}.example/`, title: `S${i}` } })) },
      into,
    );
    expect(into.size).toBe(MAX_SOURCES);
  });
});

describe("cleanReply", () => {
  it("trims, keeps markdown and caps the size", () => {
    expect(cleanReply("  **Hi** `x`\n")).toBe("**Hi** `x`");
    expect(cleanReply("a".repeat(25000))).toHaveLength(20000);
  });
});
