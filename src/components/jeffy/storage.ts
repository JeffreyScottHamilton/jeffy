import { ATTACHMENT_MIMES, type AttachmentMime, type SourceRef } from "@/lib/api-types";
import type { Conversation, Turn } from "./types";

export const CONVERSATIONS_KEY = "jeffy.conversations.v1";
export const VOICE_KEY = "jeffy.voice";
export const MAX_CONVERSATIONS = 50;
/** Image previews are persisted only as data URLs up to ~200 KB. */
export const MAX_PREVIEW_CHARS = 200 * 1024;
const TITLE_CHARS = 60;

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function titleFrom(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (!flat) return "New chat";
  const chars = Array.from(flat);
  if (chars.length <= TITLE_CHARS) return flat;
  return chars.slice(0, TITLE_CHARS - 1).join("").trimEnd() + "…";
}

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cleanAttachments(v: unknown): Turn["attachments"] {
  if (!Array.isArray(v)) return [];
  const out: Turn["attachments"] = [];
  for (const a of v) {
    if (!a || !str(a.name) || !ATTACHMENT_MIMES.includes(a.mime)) continue;
    const item: Turn["attachments"][number] = { name: a.name, mime: a.mime as AttachmentMime };
    if (str(a.previewUrl) && a.previewUrl.startsWith("data:image/") && a.previewUrl.length <= MAX_PREVIEW_CHARS) {
      item.previewUrl = a.previewUrl;
    }
    out.push(item);
  }
  return out;
}

function cleanSources(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && str(s.url))
    .map((s) => ({ url: s.url as string, title: str(s.title) ? s.title : (s.url as string) }));
}

/** Normalizes a persisted (or about-to-be persisted) turn; returns null when it isn't a turn. */
function cleanTurn(v: unknown): Turn | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if (!str(t.id) || !str(t.question)) return null;
  const status = t.status === "done" || t.status === "error" || t.status === "stopped" ? t.status : "stopped";
  const out: Turn = {
    id: t.id,
    question: t.question,
    attachments: cleanAttachments(t.attachments),
    status,
    reasoning: str(t.reasoning) ? t.reasoning : "",
    searchQueries: Array.isArray(t.searchQueries) ? t.searchQueries.filter(str) : [],
    sources: cleanSources(t.sources),
    text: str(t.text) ? t.text : "",
    voice: { status: "none" },
    startedAt: num(t.startedAt) ? t.startedAt : 0,
  };
  if (num(t.reasoningMs)) out.reasoningMs = t.reasoningMs;
  if (str(t.final)) out.final = t.final;
  const err = t.error as { message?: unknown; retryable?: unknown } | undefined;
  if (err && str(err.message)) out.error = { message: err.message, retryable: err.retryable === true };
  if (t.feedback === "up" || t.feedback === "down") out.feedback = t.feedback;
  return out;
}

function cleanConversation(v: unknown): Conversation | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  if (!str(c.id) || !Array.isArray(c.turns)) return null;
  const turns = c.turns.map(cleanTurn).filter((t): t is Turn => t !== null);
  const updatedAt = num(c.updatedAt) ? c.updatedAt : 0;
  return {
    id: c.id,
    title: str(c.title) && c.title.trim() ? c.title : titleFrom(turns[0]?.question ?? ""),
    createdAt: num(c.createdAt) ? c.createdAt : updatedAt,
    updatedAt,
    turns,
  };
}

const byRecent = (a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt;

export function loadConversations(store: KeyValueStore | null = defaultStore()): Conversation[] {
  if (!store) return [];
  try {
    const raw = store.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map(cleanConversation)
      .filter((c): c is Conversation => c !== null)
      .sort(byRecent)
      .slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

/** Persists the newest conversations; on quota errors drops the oldest until it fits. */
export function saveConversations(list: Conversation[], store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  let keep = list
    .map(cleanConversation)
    .filter((c): c is Conversation => c !== null && c.turns.length > 0)
    .sort(byRecent)
    .slice(0, MAX_CONVERSATIONS);
  while (keep.length > 0) {
    try {
      store.setItem(CONVERSATIONS_KEY, JSON.stringify(keep));
      return true;
    } catch {
      keep = keep.slice(0, -1);
    }
  }
  try {
    store.setItem(CONVERSATIONS_KEY, "[]");
    return list.length === 0;
  } catch {
    return false;
  }
}

export function loadVoicePref(store: KeyValueStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(VOICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveVoicePref(on: boolean, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    /* private mode / quota: the toggle just isn't remembered */
  }
}

export type ConversationGroup = { label: string; items: Conversation[] };

export function groupConversations(list: Conversation[], now: number): ConversationGroup[] {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  const week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7).getTime();
  const groups: ConversationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const c of [...list].sort(byRecent)) {
    const at = c.updatedAt;
    const g = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : 3;
    groups[g].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}
