"use client";

import { useEffect, useRef, useState } from "react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/prompt-kit/message";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { AudioPlayer, LivePlayer } from "./audio-player";
import { Collapse } from "./collapse";
import { CheckIcon, CopyIcon, RegenerateIcon } from "./icons";
import type { Turn } from "./types";
import type { VoiceEngine } from "./voice-engine";

/** Words keep a stable key, so each one fades in once when it first appears. */
function StreamedText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) =>
        /^\s*$/.test(p) ? (
          p
        ) : (
          <span key={i} className="jeffy-word">
            {p}
          </span>
        ),
      )}
    </>
  );
}

const ghostBtn =
  "inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-4 text-sm font-medium text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-surface active:scale-[0.97]";

export function TurnView({
  turn,
  engine,
  busy,
  onRegenerate,
  onPlaying,
  onVoiceFailed,
}: {
  turn: Turn;
  engine: VoiceEngine;
  busy: boolean;
  onRegenerate: () => void;
  onPlaying: (el: HTMLAudioElement) => void;
  onVoiceFailed: () => void;
}) {
  const { status, text, voice } = turn;
  const streaming = status === "streaming";
  const thinking = streaming && !text;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.final ?? text);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable: leave the button as is */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="jeffy-enter max-w-[85%] self-end break-words whitespace-pre-wrap rounded-2xl bg-surface px-4 py-2.5 text-[15px] leading-snug text-ink">
        {turn.question}
      </p>
      <Message className="gap-2 self-start">
        <Collapse open={thinking} className="jeffy-thinking">
          <div
            role={thinking ? "status" : undefined}
            aria-hidden={!thinking}
            className="flex min-h-8 items-center text-[15px]"
          >
            <TextShimmer>Thinking about it…</TextShimmer>
          </div>
        </Collapse>

        {text && (
          <MessageContent
            aria-live="polite"
            className="text-[16px] leading-relaxed"
          >
            <StreamedText text={text} />
          </MessageContent>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="jeffy-enter flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2"
          >
            <span className="min-w-0 text-sm text-danger">{turn.error}</span>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={busy}
              className={`${ghostBtn} disabled:opacity-40`}
            >
              Try again
            </button>
          </div>
        )}

        {voice.status === "pending" && (
          <div
            role="status"
            className="jeffy-enter flex min-h-11 items-center gap-2 text-sm text-ink-muted"
          >
            <span className="jeffy-dot size-1.5 rounded-full bg-accent" />
            Generating voice…
          </div>
        )}
        {voice.status === "live" && <LivePlayer engine={engine} />}
        {voice.status === "ready" && (
          <AudioPlayer
            key={voice.url}
            url={voice.url}
            autoplay={voice.autoplay}
            onPlaying={onPlaying}
            onFailed={onVoiceFailed}
          />
        )}
        {voice.status === "error" && (
          <div
            role="alert"
            className="jeffy-enter flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2"
          >
            <span className="min-w-0 text-sm text-danger">{voice.message}</span>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={busy}
              className={`${ghostBtn} disabled:opacity-40`}
            >
              Retry voice
            </button>
          </div>
        )}

        {status === "done" && text && (
          <MessageActions className="jeffy-enter -ml-2">
            <MessageAction
              label={copied ? "Copied" : "Copy answer"}
              onClick={copy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </MessageAction>
            <MessageAction
              label="Regenerate answer"
              onClick={onRegenerate}
              disabled={busy}
            >
              <RegenerateIcon />
            </MessageAction>
          </MessageActions>
        )}
      </Message>
    </div>
  );
}
