import { describe, expect, it } from "vitest";
import { splitReasoning } from "./reasoning-steps";

describe("splitReasoning", () => {
  it("returns nothing for empty text", () => {
    expect(splitReasoning("")).toEqual([]);
    expect(splitReasoning("  \n ")).toEqual([]);
  });

  it("splits Gemini bold-title paragraphs into steps", () => {
    const text =
      "**Understanding the question**\n\nThe user wants a table.\n\n**Planning the answer**\n\nI'll compare three options.\nThen code.";
    expect(splitReasoning(text)).toEqual([
      { title: "Understanding the question", body: "The user wants a table." },
      { title: "Planning the answer", body: "I'll compare three options.\nThen code." },
    ]);
  });

  it("keeps untitled leading text as its own step", () => {
    expect(splitReasoning("Some loose thought.\n\n**Next**\n\nBody")).toEqual([
      { title: "", body: "Some loose thought." },
      { title: "Next", body: "Body" },
    ]);
  });

  it("handles a title glued to the end of a previous sentence", () => {
    expect(splitReasoning("**A**\n\nDone here.**B**\n\nMore")).toEqual([
      { title: "A", body: "Done here." },
      { title: "B", body: "More" },
    ]);
  });

  it("treats a title still streaming as an empty step", () => {
    expect(splitReasoning("**A**\n\nBody\n\n**Checking sour")).toEqual([
      { title: "A", body: "Body" },
      { title: "Checking sour", body: "" },
    ]);
  });

  it("does not split on inline bold inside a sentence", () => {
    expect(splitReasoning("**A**\n\nThis is **really** important.")).toEqual([
      { title: "A", body: "This is **really** important." },
    ]);
  });
});
