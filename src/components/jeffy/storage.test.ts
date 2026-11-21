import { describe, expect, it } from "vitest";
import {
  CONVERSATIONS_KEY,
  MAX_CONVERSATIONS,
  MAX_PREVIEW_CHARS,
  VOICE_KEY,
  groupConversations,
  loadConversations,
  loadVoicePref,
  saveConversations,
  saveVoicePref,
  titleFrom,
  type KeyValueStore,
} from "./storage";
import { newTurn, type Conversation, type Turn } from "./types";

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.data.has(k) ? (this.data.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const turn = (over: Partial<Turn> = {}): Turn => ({
  ...newTurn("t-" + Math.random().toString(36).slice(2), "Question?"),
  status: "done",
  text: "Answer",
  final: "Answer",
  ...over,
});

const conv = (id: string, updatedAt: number, turns: Turn[] = [turn()]): Conversation => ({
  id,
  title: "Chat " + id,
  createdAt: updatedAt,
  updatedAt,
  turns,
});

describe("storage round-trip", () => {
  it("saves and loads conversations, newest first", () => {
    const s = new MemoryStore();
    const list = [conv("a", 1), conv("b", 5)];
    expect(saveConversations(list, s)).toBe(true);
    const back = loadConversations(s);
    expect(back.map((c) => c.id)).toEqual(["b", "a"]);
    expect(back[0].turns[0]).toMatchObject({ question: "Question?", final: "Answer", status: "done" });
  });

  it("strips voice state and non-data preview urls; keeps small data urls only", () => {
    const s = new MemoryStore();
    const small = "data:image/png;base64,AAAA";
    const big = "data:image/png;base64," + "A".repeat(MAX_PREVIEW_CHARS + 10);
    const t = turn({
      voice: { status: "ready", url: "blob:http://x/1", autoplay: true },
      attachments: [
        { name: "a.png", mime: "image/png", previewUrl: small },
        { name: "b.png", mime: "image/png", previewUrl: big },
        { name: "c.png", mime: "image/png", previewUrl: "blob:http://x/2" },
        { name: "d.pdf", mime: "application/pdf" },
      ],
    });
    saveConversations([conv("a", 1, [t])], s);
    const back = loadConversations(s)[0].turns[0];
    expect(back.voice).toEqual({ status: "none" });
    expect(back.attachments).toEqual([
      { name: "a.png", mime: "image/png", previewUrl: small },
      { name: "b.png", mime: "image/png" },
      { name: "c.png", mime: "image/png" },
      { name: "d.pdf", mime: "application/pdf" },
    ]);
  });

  it("marks turns left streaming as stopped", () => {
    const s = new MemoryStore();
    saveConversations([conv("a", 1, [turn({ status: "streaming", final: undefined, text: "half" })])], s);
    expect(loadConversations(s)[0].turns[0].status).toBe("stopped");
  });

  it("caps the list at the most recent conversations", () => {
    const s = new MemoryStore();
    const list = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, i) => conv(String(i), i));
    saveConversations(list, s);
    const back = loadConversations(s);
    expect(back).toHaveLength(MAX_CONVERSATIONS);
    expect(back[0].id).toBe(String(MAX_CONVERSATIONS + 4));
    expect(back.some((c) => c.id === "0")).toBe(false);
  });

  it("returns [] for missing, corrupt or wrong-shaped JSON", () => {
    const s = new MemoryStore();
    expect(loadConversations(s)).toEqual([]);
    s.data.set(CONVERSATIONS_KEY, "{not json");
    expect(loadConversations(s)).toEqual([]);
    s.data.set(CONVERSATIONS_KEY, JSON.stringify({ a: 1 }));
    expect(loadConversations(s)).toEqual([]);
    s.data.set(
      CONVERSATIONS_KEY,
      JSON.stringify([null, 3, { id: "x" }, { id: "ok", title: "T", createdAt: 1, updatedAt: 2, turns: [{ bad: 1 }] }]),
    );
    const back = loadConversations(s);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: "ok", turns: [] });
  });

  it("survives a store that throws on read", () => {
    const s: KeyValueStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadConversations(s)).toEqual([]);
    expect(loadVoicePref(s)).toBe(false);
  });

  it("drops oldest conversations on quota errors and reports failure when nothing fits", () => {
    const s = new MemoryStore();
    const list = [conv("new", 3), conv("mid", 2), conv("old", 1)];
    const one = JSON.stringify(list.slice(0, 1)).length;
    s.quota = one * 2 + 50;
    expect(saveConversations(list, s)).toBe(true);
    const ids = loadConversations(s).map((c) => c.id);
    expect(ids[0]).toBe("new");
    expect(ids).not.toContain("old");

    s.quota = 1;
    expect(saveConversations(list, s)).toBe(false);
  });

  it("round-trips the voice preference", () => {
    const s = new MemoryStore();
    expect(loadVoicePref(s)).toBe(false);
    saveVoicePref(true, s);
    expect(s.getItem(VOICE_KEY)).toBe("1");
    expect(loadVoicePref(s)).toBe(true);
    saveVoicePref(false, s);
    expect(loadVoicePref(s)).toBe(false);
  });
});

describe("titleFrom", () => {
  it("collapses whitespace and truncates to 60 chars", () => {
    expect(titleFrom("  Hello\n world  ")).toBe("Hello world");
    const t = titleFrom("x".repeat(100));
    expect(Array.from(t).length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
    expect(titleFrom("   ")).toBe("New chat");
  });
});

describe("groupConversations", () => {
  it("groups by Today / Yesterday / Previous 7 days / Older", () => {
    const now = new Date(2026, 10, 21, 15, 0).getTime();
    const day = 86_400_000;
    const groups = groupConversations(
      [
        conv("today", now - 3_600_000),
        conv("yesterday", now - day),
        conv("week", now - 4 * day),
        conv("old", now - 30 * day),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ]);
  });
});
