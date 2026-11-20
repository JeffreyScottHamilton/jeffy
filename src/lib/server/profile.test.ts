import { describe, expect, it } from "vitest";
import { loadProfile, parseProfile, selectRelevant } from "./profile";

async function example() {
  return (await loadProfile({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).profile;
}

describe("selectRelevant", () => {
  it("picks matching items for a relevant question", async () => {
    const ex = selectRelevant(await example(), "How do you like your coffee?", []);
    expect(ex.items.some((i) => i.topic === "coffee")).toBe(true);
    expect(ex.items.length).toBeLessThanOrEqual(6);
    expect(ex.examples.length).toBeLessThanOrEqual(2);
    expect(ex.examples.some((e) => /coffee/i.test(e.question))).toBe(true);
  });
  it("returns nothing for unrelated questions but keeps style/phrases", async () => {
    const ex = selectRelevant(await example(), "Quantum chromodynamics zebra?", []);
    expect(ex.items).toEqual([]);
    expect(ex.examples).toEqual([]);
    expect(ex.name).toBe("Riley Park");
    expect(ex.style.length).toBeGreaterThan(0);
  });
  it("caps phrases at 4", async () => {
    const p = { ...(await example()), phrases: ["a", "b", "c", "d", "e", "f"] };
    expect(selectRelevant(p, "hi", []).phrases).toHaveLength(4);
  });
  it("uses last history question with lower weight", async () => {
    const ex = selectRelevant(await example(), "and what about it?", [{ question: "Tell me about your cat", reply: "x" }]);
    expect(ex.items.some((i) => i.topic === "pet")).toBe(true);
  });
  it("singularizes plural tokens", async () => {
    const ex = selectRelevant(await example(), "any good movies?", []);
    expect(ex.items.some((i) => i.topic === "movies")).toBe(true);
  });
});

describe("selectRelevant relative dates", () => {
  const item = (text: string) => ({ topic: "diary", keywords: [], text });
  const withDays = async () => ({
    ...(await example()),
    facts: [item("November 1, 2026: went hiking."), item("November 19, 2026: baked bread."), item("November 20, 2026: wrote code.")],
    preferences: [],
  });
  const now = new Date("2026-11-20T18:00:00Z");
  it("selects yesterday's entry and not a prefix-matching day", async () => {
    const ex = selectRelevant(await withDays(), "what happened yesterday?", [], now, "America/Denver");
    expect(ex.items.map((i) => i.text)).toEqual(["November 19, 2026: baked bread."]);
  });
  it("selects today's entry", async () => {
    const ex = selectRelevant(await withDays(), "what did you do today?", [], now, "America/Denver");
    expect(ex.items.map((i) => i.text)).toEqual(["November 20, 2026: wrote code."]);
  });
  it("uses the timezone for the local date", async () => {
    const late = new Date("2026-11-20T03:00:00Z"); // Nov 19 evening in Denver
    const ex = selectRelevant(await withDays(), "what happened today?", [], late, "America/Denver");
    expect(ex.items.map((i) => i.text)).toEqual(["November 19, 2026: baked bread."]);
  });
});

describe("parseProfile", () => {
  it("rejects bad shapes without echoing values", () => {
    const secret = "SUPER-SECRET-VALUE";
    const bad: unknown[] = [
      null,
      [secret],
      { name: secret },
      { name: "n", summary: "s", style: "t", phrases: [secret, 1], facts: [], preferences: [], examples: [] },
      { name: "n", summary: "s", style: "t", phrases: [], facts: [{ topic: secret }], preferences: [], examples: [] },
      { name: "n", summary: "s", style: "t", phrases: [], facts: [], preferences: [], examples: [{ question: secret, answer: 3 }] },
    ];
    for (const b of bad) {
      let msg = "";
      try {
        parseProfile(b);
      } catch (e) {
        msg = (e as Error).message;
        expect((e as Error).name).toBe("ProfileError");
      }
      expect(msg).not.toBe("");
      expect(msg).not.toContain(secret);
    }
  });
  it("accepts the example shape", async () => {
    expect((await example()).facts.length).toBeGreaterThanOrEqual(8);
  });
});

describe("loadProfile", () => {
  const custom = JSON.stringify({ name: "Zed", summary: "", style: "", phrases: [], facts: [], preferences: [], examples: [] });
  it("uses env JSON when set", async () => {
    const r = await loadProfile({ JEFFY_PROFILE_JSON: custom } as unknown as NodeJS.ProcessEnv);
    expect(r.source).toBe("env");
    expect(r.profile.name).toBe("Zed");
  });
  it("forces example in preview even with JEFFY_PROFILE_JSON", async () => {
    const r = await loadProfile({ VERCEL_ENV: "preview", JEFFY_PROFILE_JSON: custom } as unknown as NodeJS.ProcessEnv);
    expect(r.source).toBe("example");
    expect(r.profile.name).toBe("Riley Park");
  });
  it("does not leak invalid env JSON content", async () => {
    await expect(loadProfile({ JEFFY_PROFILE_JSON: "{oops-secret" } as unknown as NodeJS.ProcessEnv)).rejects.toThrow(/not valid JSON/);
  });
});
