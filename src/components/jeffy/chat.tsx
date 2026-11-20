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
  type ChatMode,
  type ChatRequest,
} from "@/lib/api-types";
import { SendIcon, StopIcon, WaveformIcon } from "./icons";
import { TalkView } from "./talk-view";
import { TurnView } from "./turn-view";
import { newTurn, type Turn } from "./types";
import { VoiceEngine } from "./voice-engine";

const NETWORK_MSG = "Couldn't reach Jeffy. Check your connection and try again.";
const GENERIC_MSG = "Something went wrong. Try again.";
const NO_VOICE_MSG = "The voice didn't arrive. Try again.";
const SUGGESTIONS = [
  "What have you been working on lately?",
  "How was Sadie's?",
  "What happened yesterday?",
];

function b64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [engine] = useState(() => new VoiceEngine());
  const talkButton = useRef<HTMLButtonElement>(null);
  const runningRef = useRef(false);
  /** Per-turn voice errors held until the audio that already arrived has played. */
  const voiceErrors = useRef(new Map<string, string>());
  /** Turns whose live voice was stopped by the user: later chunks are dropped. */
  const silenced = useRef(new Set<string>());
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
      engine.dispose();
      current.current?.pause();
      map.forEach((u) => URL.revokeObjectURL(u));
      map.clear();
    };
  }, [engine]);

  const patch = (id: string, fn: (t: Turn) => Turn) =>
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const revoke = (id: string) => {
    const old = urls.current.get(id);
    if (old) {
      URL.revokeObjectURL(old);
      urls.current.delete(id);
    }
  };

  const startLive = (id: string) => {
    engine.begin(id, (r) => {
      const err = voiceErrors.current.get(id);
      voiceErrors.current.delete(id);
      if (err) {
        patch(id, (t) => (t.voice.status === "live" ? { ...t, voice: { status: "error", message: err } } : t));
        return;
      }
      if (!r.complete) silenced.current.add(id);
      if (r.wav) {
        revoke(id);
        const url = URL.createObjectURL(r.wav);
        urls.current.set(id, url);
        patch(id, (t) =>
          t.voice.status === "live" ? { ...t, voice: { status: "ready", url, autoplay: false } } : t,
        );
      } else {
        patch(id, (t) => (t.voice.status === "live" ? { ...t, voice: { status: "none" } } : t));
      }
    });
    patch(id, (t) => ({ ...t, voice: { status: "live" } }));
  };

  const apply = (id: string, ev: ChatEvent, mode: ChatMode = "text") => {
    switch (ev.type) {
      case "text":
        patch(id, (t) => ({ ...t, text: t.text + ev.delta }));
        break;
      case "text_done":
        patch(id, (t) => ({
          ...t,
          status: "done",
          text: ev.text,
          final: ev.text,
          voice: t.voice.status === "none" ? { status: "pending" } : t.voice,
        }));
        break;
      case "audio_chunk":
        if (silenced.current.has(id)) break;
        if (engine.turnId !== id) startLive(id);
        engine.push(b64ToBytes(ev.data), ev.sampleRate);
        break;
      case "audio_end":
        if (engine.turnId === id) engine.end();
        break;
      case "audio": {
        if (silenced.current.has(id)) break;
        revoke(id);
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = b64ToBytes(ev.data);
        } catch {
          patch(id, (t) => ({ ...t, voice: { status: "error", message: NO_VOICE_MSG } }));
          break;
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: ev.mime }));
        urls.current.set(id, url);
        if (mode === "talk") {
          // Talk mode speaks through the engine so the orb can follow the output level.
          patch(id, (t) => ({ ...t, voice: { status: "ready", url, autoplay: false } }));
          void engine.playEncoded(id, bytes.slice().buffer, () => {});
        } else {
          patch(id, (t) => ({ ...t, voice: { status: "ready", url, autoplay: true } }));
        }
        break;
      }
      case "audio_error":
        if (silenced.current.has(id)) break;
        if (engine.turnId === id) {
          voiceErrors.current.set(id, ev.message);
          engine.end();
        } else {
          patch(id, (t) => ({ ...t, voice: { status: "error", message: ev.message } }));
        }
        break;
      case "error":
        patch(id, (t) => ({ ...t, status: "error", error: ev.message }));
        break;
    }
  };

  const run = async (id: string, question: string, before: Turn[], mode: ChatMode) => {
    const history = before
      .filter((t) => t.final)
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ question: t.question, reply: t.final as string }));
    const body: ChatRequest = { question, history, mode };
    const ctrl = new AbortController();
    abort.current = ctrl;
    runningRef.current = true;
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
        if (ev.type === "audio" || ev.type === "audio_error" || ev.type === "audio_chunk") gotAudio = true;
        apply(id, ev, mode);
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
      if (engine.turnId === id) engine.end(); // stream closed without audio_end: play out what arrived
      if (!sawError && !gotText) {
        apply(id, { type: "error", code: "internal", message: GENERIC_MSG, retryable: true });
      } else if (gotText && !gotAudio) {
        apply(id, { type: "audio_error", code: "internal", message: NO_VOICE_MSG, retryable: true });
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        // Stopped by the user: keep whatever text arrived.
        if (engine.turnId === id) engine.stop();
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
        runningRef.current = false;
        setRunning(false);
      }
    }
  };

  const ask = (
    question: string,
    { replaceId, mode = "text" }: { replaceId?: string; mode?: ChatMode } = {},
  ): string | null => {
    if (runningRef.current) return null;
    // Runs inside the click/submit gesture, which is what lets the AudioContext start.
    engine.unlock();
    engine.stop();
    current.current?.pause();
    const index = replaceId ? turns.findIndex((t) => t.id === replaceId) : turns.length;
    const before = turns.slice(0, Math.max(index, 0));
    const id = replaceId ?? crypto.randomUUID();
    silenced.current.delete(id);
    voiceErrors.current.delete(id);
    if (replaceId) {
      revoke(id);
      setTurns((ts) => ts.map((t) => (t.id === id ? newTurn(id, question) : t)));
    } else {
      setTurns((ts) => [...ts, newTurn(id, question)]);
    }
    runningRef.current = true;
    void run(id, question, before, mode);
    return id;
  };

  const send = () => {
    if (!canSend) return;
    setDraft("");
    ask(trimmed);
  };

  const onPlaying = (el: HTMLAudioElement) => {
    engine.stop();
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
                  Ask me anything.
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
              engine={engine}
              onRegenerate={() => ask(t.question, { replaceId: t.id })}
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
            <button
              ref={talkButton}
              type="button"
              aria-label="Talk to Jeffy"
              onClick={(e) => {
                e.stopPropagation();
                engine.unlock();
                setTalkOpen(true);
              }}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-surface active:scale-95"
            >
              <WaveformIcon />
            </button>
            {running ? (
              <button
                type="button"
                aria-label="Stop answering"
                onClick={(e) => {
                  e.stopPropagation();
                  abort.current?.abort();
                  engine.stop();
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
      </div>
      {talkOpen && (
        <TalkView
          engine={engine}
          turns={turns}
          onUtterance={(text) => ask(text, { mode: "talk" })}
          onInterrupt={() => {
            abort.current?.abort();
            engine.stop();
          }}
          onClose={() => {
            abort.current?.abort();
            engine.stop();
            setTalkOpen(false);
            requestAnimationFrame(() => talkButton.current?.focus());
          }}
        />
      )}
    </>
  );
}
