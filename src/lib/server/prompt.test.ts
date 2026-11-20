import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt";

const excerpt = { name: "Zed", style: "casual", phrases: [], items: [], examples: [] };

describe("buildPrompt", () => {
  it("tells the model to resolve references from the conversation", () => {
    const { systemInstruction } = buildPrompt(excerpt, [], "what was it about?");
    expect(systemInstruction).toContain("Use the conversation so far to work out what");
    expect(systemInstruction).toContain("Only if nothing in the profile relates at all");
  });
  it("sends the full history", () => {
    const h = Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, reply: `r${i}` }));
    expect(buildPrompt(excerpt, h, "q").contents).toHaveLength(13);
  });
});
