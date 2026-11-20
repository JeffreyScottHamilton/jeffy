"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/prompt-kit/chat-container";
import {
  PromptInput,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  REPLY_HEADER,
  type ChatErrorBody,
  type ChatRequest,
} from "@/lib/api-types";
import { AudioCard, type Turn } from "./audio-card";
import { SendIcon } from "./icons";

const NETWORK_MSG = "Couldn't reach Jeffy. Check your connection and try again.";
const GENERIC_MSG = "Something went wrong. Try again.";

function decodeReply(header: string | null): string | undefined {
  if (!header) return undefined;
  try {
    const b64 = header.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const current = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());

  const pending = turns.some((t) => t.status === "pending");
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !pending;

  const update = (id: string, patch: Partial<Turn>) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const request = async (id: string, question: string, before: Turn[]) => {
    const history = before
      .filter((t) => t.status === "ready" && t.reply)
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ question: t.question, reply: t.reply as string }));
    const body: ChatRequest = { question, history };
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let message = GENERIC_MSG;
        try {
          const data = (await res.json()) as ChatErrorBody;
          if (typeof data?.error?.message === "string") {
            message = data.error.message;
          }
        } catch {
          /* keep generic */
        }
        update(id, { status: "error", error: message });
        return;
      }
      const reply = decodeReply(res.headers.get(REPLY_HEADER));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urls.current.set(id, url);
      update(id, {
        status: "ready",
        audioUrl: url,
        reply,
        error: undefined,
        autoplay: true,
      });
    } catch {
      update(id, { status: "error", error: NETWORK_MSG });
    }
  };

  const send = () => {
    if (!canSend) return;
    const id = crypto.randomUUID();
    const turn: Turn = { id, question: trimmed, status: "pending" };
    setTurns((ts) => [...ts.map((t) => ({ ...t, autoplay: false })), turn]);
    setDraft("");
    void request(id, trimmed, turns);
  };

  const retry = (turn: Turn) => {
    if (pending) return;
    const old = urls.current.get(turn.id);
    if (old) {
      URL.revokeObjectURL(old);
      urls.current.delete(turn.id);
    }
    const index = turns.findIndex((t) => t.id === turn.id);
    setTurns((ts) =>
      ts.map((t) =>
        t.id === turn.id
          ? { ...t, status: "pending", audioUrl: undefined, error: undefined }
          : { ...t, autoplay: false },
      ),
    );
    void request(turn.id, turn.question, turns.slice(0, Math.max(index, 0)));
  };

  const onPlaying = (el: HTMLAudioElement) => {
    if (current.current && current.current !== el) current.current.pause();
    current.current = el;
  };

  const near = draft.length >= MAX_QUESTION_CHARS - 100;

  return (
    <>
      <ChatContainerRoot className="min-h-0 flex-1">
        <ChatContainerContent className="gap-6 px-5 py-4">
          {turns.length === 0 && (
            <p className="mt-[20dvh] text-center text-[15px] text-ink-muted">
              Type a question. Jeffy answers out loud.
            </p>
          )}
          {turns.map((t) => (
            <div key={t.id} className="flex flex-col gap-2">
              <p className="jeffy-enter max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl bg-surface px-4 py-2.5 text-[15px] leading-snug text-ink">
                {t.question}
              </p>
              <div className="max-w-[92%] self-start">
                <AudioCard
                  turn={t}
                  onRetry={() => retry(t)}
                  onPlaying={onPlaying}
                />
              </div>
            </div>
          ))}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
      </ChatContainerRoot>
      <div className="shrink-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <PromptInput
          value={draft}
          onValueChange={setDraft}
          onSubmit={send}
          disabled={pending}
          isLoading={pending}
          className="flex items-end gap-1 rounded-3xl border-line bg-paper p-1.5 pl-3 shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cobalt"
        >
          <PromptInputTextarea
            placeholder="Ask Jeffy something…"
            aria-label="Your question"
            maxLength={MAX_QUESTION_CHARS}
            className="min-h-11 flex-1 px-1 py-2.5 !text-base text-ink placeholder:text-ink-muted"
          />
          <PromptInputActions>
            {near && (
              <span
                className="text-xs tabular-nums text-ink-muted"
                aria-live="polite"
              >
                {draft.length}/{MAX_QUESTION_CHARS}
              </span>
            )}
            <button
              type="button"
              aria-label="Send question"
              disabled={!canSend}
              onClick={(e) => {
                e.stopPropagation();
                send();
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-cobalt text-white transition-colors hover:bg-cobalt-press disabled:opacity-40"
            >
              <SendIcon />
            </button>
          </PromptInputActions>
        </PromptInput>
        <p className="mt-2 text-center text-xs text-ink-muted">
          Replies are AI-generated audio.
        </p>
      </div>
      <UrlCleanup urls={urls} />
    </>
  );
}

function UrlCleanup({ urls }: { urls: RefObject<Map<string, string>> }) {
  useEffect(() => {
    const map = urls.current;
    return () => {
      map.forEach((u) => URL.revokeObjectURL(u));
      map.clear();
    };
  }, [urls]);
  return null;
}
