"use client";

import { useEffect, useRef, useState } from "react";
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
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  type ChatErrorBody,
  type ChatEvent,
  type ChatRequest,
} from "@/lib/api-types";
import { SendIcon, StopIcon } from "./icons";
import { TurnView } from "./turn-view";
import { newTurn, type Turn } from "./types";

const NETWORK_MSG = "Couldn't reach Jeffy. Check your connection and try again.";
const GENERIC_MSG = "Something went wrong. Try again.";
const NO_VOICE_MSG = "The voice didn't arrive. Try again.";
const SUGGESTIONS = [
  "What have you been working on lately?",
  "How was Sadie's?",
  "What happened yesterday?",
];

function blobUrl(data: string, mime: string): string {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const current = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const abort = useRef<AbortController | null>(null);

  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !running;

  // Abort any open stream and release audio on unmount.
  useEffect(() => {
    const map = urls.current;
    return () => {
      abort.current?.abort();
      current.current?.pause();
      map.forEach((u) => URL.revokeObjectURL(u));
      map.clear();
    };
  }, []);

  const patch = (id: string, fn: (t: Turn) => Turn) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const revoke = (id: string) => {
    const old = urls.current.get(id);
    if (old) {
      URL.revokeObjectURL(old);
      urls.current.delete(id);
    }
  };

  const apply = (id: string, ev: ChatEvent) => {
    switch (ev.type) {
      case "memories":
        patch(id, (t) => ({ ...t, memories: ev.topics }));
        break;
      case "reasoning":
        patch(id, (t) => ({ ...t, reasoning: t.reasoning + ev.delta }));
        break;
      case "text":
        patch(id, (t) => ({ ...t, text: t.text + ev.delta }));
        break;
      case "text_done":
        patch(id, (t) => ({
          ...t,
          status: "done",
          text: ev.text,
          final: ev.text,
          voice: { status: "pending" },
        }));
        break;
      case "audio": {
        revoke(id);
        let url: string;
        try {
          url = blobUrl(ev.data, ev.mime);
        } catch {
          patch(id, (t) => ({ ...t, voice: { status: "error", message: NO_VOICE_MSG } }));
          break;
        }
        urls.current.set(id, url);
        patch(id, (t) => ({ ...t, voice: { status: "ready", url, autoplay: true } }));
        break;
      }
      case "audio_error":
        patch(id, (t) => ({ ...t, voice: { status: "error", message: ev.message } }));
        break;
      case "error":
        patch(id, (t) => ({ ...t, status: "error", error: ev.message }));
        break;
    }
  };

  const run = async (id: string, question: string, before: Turn[]) => {
    const history = before
      .filter((t) => t.final)
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ question: t.question, reply: t.final as string }));
    const body: ChatRequest = { question, history };
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    let sawError = false;
    let gotText = false;
    let gotAudio = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        let message = GENERIC_MSG;
        try {
          const data = (await res.json()) as ChatErrorBody;
          if (typeof data?.error?.message === "string") message = data.error.message;
        } catch {
          /* keep generic */
        }
        apply(id, { type: "error", code: "internal", message, retryable: true });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const handle = (raw: string) => {
        if (!raw.trim()) return;
        let ev: ChatEvent;
        try {
          ev = JSON.parse(raw) as ChatEvent;
        } catch {
          return;
        }
        if (ev.type === "error") sawError = true;
        if (ev.type === "text_done") gotText = true;
        if (ev.type === "audio" || ev.type === "audio_error") gotAudio = true;
        apply(id, ev);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      handle(buf + decoder.decode());
      if (!sawError && !gotText) {
        apply(id, { type: "error", code: "internal", message: GENERIC_MSG, retryable: true });
      } else if (gotText && !gotAudio) {
        apply(id, { type: "audio_error", code: "internal", message: NO_VOICE_MSG, retryable: true });
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        // Stopped by the user: keep whatever text arrived.
        patch(id, (t) =>
          t.final
            ? { ...t, voice: t.voice.status === "pending" ? { status: "none" } : t.voice }
            : t.text
              ? { ...t, status: "done", voice: { status: "none" } }
              : { ...t, status: "error", error: "Stopped before Jeffy answered." },
        );
      } else {
        apply(id, { type: "error", code: "internal", message: NETWORK_MSG, retryable: true });
      }
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setRunning(false);
      }
    }
  };

  const ask = (question: string, replaceId?: string) => {
    if (running) return;
    current.current?.pause();
    const index = replaceId ? turns.findIndex((t) => t.id === replaceId) : turns.length;
    const before = turns.slice(0, Math.max(index, 0));
    const id = replaceId ?? crypto.randomUUID();
    if (replaceId) {
      revoke(id);
      setTurns((ts) => ts.map((t) => (t.id === id ? newTurn(id, question) : t)));
    } else {
      setTurns((ts) => [...ts, newTurn(id, question)]);
    }
    void run(id, question, before);
  };

  const send = () => {
    if (!canSend) return;
    setDraft("");
    ask(trimmed);
  };

  const onPlaying = (el: HTMLAudioElement) => {
    if (current.current && current.current !== el) current.current.pause();
    current.current = el;
  };

  const near = draft.length >= MAX_QUESTION_CHARS - 100;

  return (
    <>
      <ChatContainerRoot className="relative min-h-0 flex-1">
        <ChatContainerContent className="gap-8 px-5 py-4">
          {turns.length === 0 && (
            <div className="jeffy-enter mt-[12dvh] flex flex-col items-center gap-6 text-center">
              <div className="space-y-1.5">
                <p className="text-2xl font-medium tracking-tight text-ink">
                  Hi, I&apos;m Jeffy.
                </p>
                <p className="text-[15px] text-ink-muted">
                  Ask anything. I&apos;ll think it through and answer out loud.
                </p>
              </div>
              <div className="flex w-full flex-col items-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <PromptSuggestion key={s} onClick={() => ask(s)}>
                    {s}
                  </PromptSuggestion>
                ))}
              </div>
            </div>
          )}
          {turns.map((t) => (
            <TurnView
              key={t.id}
              turn={t}
              busy={running}
              onRegenerate={() => ask(t.question, t.id)}
              onPlaying={onPlaying}
              onVoiceFailed={() =>
                patch(t.id, (x) => ({
                  ...x,
                  voice: { status: "error", message: "This reply couldn't play." },
                }))
              }
            />
          ))}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <ScrollButton className="pointer-events-auto" />
        </div>
      </ChatContainerRoot>
      <div className="shrink-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <PromptInput
          value={draft}
          onValueChange={setDraft}
          onSubmit={send}
          className="flex items-end gap-1 rounded-3xl border-line bg-raised p-1.5 pl-3 shadow-none transition-colors has-[:focus-visible]:border-accent/60"
        >
          <PromptInputTextarea
            placeholder="Ask Jeffy something…"
            aria-label="Your question"
            maxLength={MAX_QUESTION_CHARS}
            className="min-h-11 flex-1 px-1 py-2.5 !text-base text-ink placeholder:text-ink-muted focus-visible:!outline-none focus-visible:!ring-0"
          />
          <PromptInputActions>
            {near && (
              <span className="text-xs tabular-nums text-ink-muted" aria-live="polite">
                {draft.length}/{MAX_QUESTION_CHARS}
              </span>
            )}
            {running ? (
              <button
                type="button"
                aria-label="Stop answering"
                onClick={(e) => {
                  e.stopPropagation();
                  abort.current?.abort();
                }}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-track active:scale-95"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send question"
                disabled={!canSend}
                onClick={(e) => {
                  e.stopPropagation();
                  send();
                }}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-cobalt text-white transition-[background-color,opacity,transform] duration-150 ease-out hover:bg-cobalt-press active:scale-95 disabled:opacity-40"
              >
                <SendIcon />
              </button>
            )}
          </PromptInputActions>
        </PromptInput>
        <p className="mt-2 text-center text-xs text-ink-muted">
          Replies and voice are AI-generated.
        </p>
      </div>
    </>
  );
}
