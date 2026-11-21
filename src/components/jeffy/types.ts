import type { AttachmentMime, SourceRef } from "@/lib/api-types";

export type VoiceState =
  | { status: "none" }
  | { status: "pending" }
  /** Chunks are playing through the VoiceEngine while the reply is still arriving. */
  | { status: "live" }
  | { status: "ready"; url: string; autoplay: boolean }
  | { status: "error"; message: string };

export type Turn = {
  id: string; question: string; attachments: { name: string; mime: AttachmentMime; previewUrl?: string }[];
  status: "streaming" | "done" | "error" | "stopped";
  reasoning: string; reasoningMs?: number; searchQueries: string[]; sources: SourceRef[];
  text: string; final?: string; voice: VoiceState; error?: { message: string; retryable: boolean };
  feedback?: "up" | "down"; startedAt: number;
};
export type Conversation = { id: string; title: string; createdAt: number; updatedAt: number; turns: Turn[] };

export const newTurn = (id: string, question: string, attachments: Turn["attachments"] = []): Turn => ({
  id,
  question,
  attachments,
  status: "streaming",
  reasoning: "",
  searchQueries: [],
  sources: [],
  text: "",
  voice: { status: "none" },
  startedAt: Date.now(),
});
