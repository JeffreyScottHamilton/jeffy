"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileText, Pencil, RefreshCw, StopCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { FeedbackBar } from "@/components/prompt-kit/feedback-bar";
import { Image } from "@/components/prompt-kit/image";
import { Loader } from "@/components/prompt-kit/loader";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageAvatar,
  MessageContent,
} from "@/components/prompt-kit/message";
import { Source, SourceContent, SourceTrigger } from "@/components/prompt-kit/source";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { ThinkingBar } from "@/components/prompt-kit/thinking-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isImage, splitDataUrl } from "./attachments";
import { AudioPlayer, LivePlayer } from "./audio-player";
import { MarkdownBody } from "./markdown-body";
import { SearchPanel, ThinkingPanel } from "./thinking";
import type { Turn } from "./types";
import type { VoiceEngine } from "./voice-engine";

export const JEFFY_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a5b8ff"/><stop offset=".55" stop-color="#4f6ef0"/><stop offset="1" stop-color="#2a1f8f"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/><path d="M32 15l3.6 10.4L46 29l-10.4 3.6L32 43l-3.6-10.4L18 29l10.4-3.6z" fill="#fff" fill-opacity=".95"/><circle cx="44" cy="44" r="3" fill="#fff" fill-opacity=".7"/></svg>`,
  );

function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };
  return { copied, copy };
}

const actionBtn = "text-muted-foreground hover:text-foreground size-8 rounded-full";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function UserMessage({ turn, onEdit }: { turn: Turn; onEdit: () => void }) {
  const { copied, copy } = useCopied();
  return (
    <Message className="group/user jeffy-enter flex-col items-end gap-1.5">
      {turn.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {turn.attachments.map((a, i) => {
            const img = a.previewUrl ? splitDataUrl(a.previewUrl) : null;
            return isImage(a.mime) && img ? (
              <Image
                key={i}
                base64={img.base64}
                mediaType={img.mediaType}
                alt={a.name}
                className="h-28 w-auto max-w-56 rounded-2xl border object-cover"
              />
            ) : (
              <span
                key={i}
                className="bg-secondary/70 flex h-12 max-w-56 items-center gap-2 rounded-xl border px-3 text-xs"
              >
                <FileText className="text-primary size-4 shrink-0" aria-hidden />
                <span className="truncate">{a.name}</span>
              </span>
            );
          })}
        </div>
      )}
      <MessageContent className="bg-secondary text-foreground max-w-[85%] rounded-3xl px-4.5 py-2.5 text-[15.5px] leading-relaxed whitespace-pre-wrap sm:max-w-[75%]">
        {turn.question}
      </MessageContent>
      <MessageActions className="gap-0 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        <MessageAction tooltip={copied ? "Copied" : "Copy"} delayDuration={150}>
          <Button variant="ghost" size="icon" className={actionBtn} aria-label="Copy message" onClick={() => void copy(turn.question)}>
            {copied ? <Check /> : <Copy />}
          </Button>
        </MessageAction>
        <MessageAction tooltip="Edit" delayDuration={150}>
          <Button variant="ghost" size="icon" className={actionBtn} aria-label="Edit message" onClick={onEdit}>
            <Pencil />
          </Button>
        </MessageAction>
      </MessageActions>
    </Message>
  );
}

export function TurnView({
  turn,
  engine,
  busy,
  isLast,
  searchRequested,
  onRegenerate,
  onEdit,
  onStop,
  onFeedback,
  onPlaying,
  onVoiceFailed,
}: {
  turn: Turn;
  engine: VoiceEngine;
  busy: boolean;
  isLast: boolean;
  /** The in-flight request asked for web search (shows the search card before queries arrive). */
  searchRequested: boolean;
  onRegenerate: () => void;
  onEdit: () => void;
  onStop: () => void;
  onFeedback: (f: "up" | "down" | undefined) => void;
  onPlaying: (el: HTMLAudioElement) => void;
  onVoiceFailed: () => void;
}) {
  const { status, text, voice, reasoning } = turn;
  const streaming = status === "streaming";
  const waiting = streaming && !text && !reasoning && turn.searchQueries.length === 0;
  const thinking = streaming && !text && !!reasoning;
  const searching = streaming && !text && turn.sources.length === 0;
  const answered = !!text && (status === "done" || status === "stopped");
  const { copied, copy } = useCopied();
  const [feedbackClosed, setFeedbackClosed] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <UserMessage turn={turn} onEdit={onEdit} />
      <Message className="jeffy-enter items-start gap-3.5">
        <MessageAvatar
          src={JEFFY_AVATAR}
          alt="Jeffy"
          fallback="J"
          className={cn("mt-0.5 size-7 ring-1 ring-white/10", streaming && "jeffy-avatar-live")}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3.5" aria-busy={streaming}>
          {waiting && (
            <div role="status" className="flex h-7 max-w-md items-center">
              <ThinkingBar
                text={searchRequested ? "Searching the web" : "Thinking"}
                onStop={onStop}
                stopLabel="Stop"
              />
            </div>
          )}

          {reasoning && <ThinkingPanel reasoning={reasoning} thinking={thinking} reasoningMs={turn.reasoningMs} />}

          {turn.searchQueries.length > 0 && (
            <SearchPanel queries={turn.searchQueries} sources={turn.sources} searching={searching} />
          )}

          {text && (
            <div aria-live={streaming ? "polite" : undefined} className="min-w-0">
              <MarkdownBody id={turn.id} text={text} streaming={streaming} />
            </div>
          )}

          {turn.sources.length > 0 && !streaming && (
            <div className="jeffy-enter flex flex-wrap items-center gap-1.5" aria-label="Sources">
              <span className="text-muted-foreground mr-1 text-xs font-medium">Sources</span>
              {turn.sources.map((s, i) => (
                <Source key={s.url} href={s.url}>
                  <SourceTrigger label={`${i + 1} ${hostOf(s.url)}`} showFavicon className="h-6 max-w-44 px-2 pl-1.5" />
                  <SourceContent title={s.title} description={s.url} className="bg-popover" />
                </Source>
              ))}
            </div>
          )}

          {status === "error" && (
            <SystemMessage
              variant="error"
              fill
              role="alert"
              className="max-w-xl text-red-300 dark:text-red-300"
              cta={turn.error?.retryable && !busy ? { label: "Retry", onClick: onRegenerate } : undefined}
            >
              {turn.error?.message ?? "Something went wrong."}
            </SystemMessage>
          )}

          {status === "stopped" && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <StopCircle className="size-3.5" aria-hidden />
              {text ? "Stopped early" : "Stopped before Jeffy answered"}
            </p>
          )}

          {voice.status === "pending" && (
            <div role="status" className="jeffy-enter text-muted-foreground flex h-10 items-center gap-3 text-sm">
              <Loader variant="wave" size="sm" />
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
            <SystemMessage variant="warning" fill className="max-w-xl text-amber-300/95 dark:text-amber-300/95">
              {voice.message}
            </SystemMessage>
          )}

          {(answered || (status === "stopped" && !text)) && (
            <MessageActions className={cn("-mt-1 -ml-2 gap-0 transition-opacity", !isLast && "opacity-70 hover:opacity-100")}>
              {text && (
                <MessageAction tooltip={copied ? "Copied" : "Copy"} delayDuration={150}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={actionBtn}
                    aria-label={copied ? "Copied" : "Copy answer"}
                    onClick={() => void copy(turn.final ?? text)}
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </MessageAction>
              )}
              <MessageAction tooltip="Regenerate" delayDuration={150}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={actionBtn}
                  aria-label="Regenerate answer"
                  onClick={onRegenerate}
                  disabled={busy}
                >
                  <RefreshCw />
                </Button>
              </MessageAction>
              {turn.feedback && (
                <MessageAction tooltip="Undo feedback" delayDuration={150}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(actionBtn, "text-primary")}
                    aria-label={turn.feedback === "up" ? "Marked helpful, undo" : "Marked not helpful, undo"}
                    aria-pressed
                    onClick={() => onFeedback(undefined)}
                  >
                    {turn.feedback === "up" ? <ThumbsUp /> : <ThumbsDown />}
                  </Button>
                </MessageAction>
              )}
            </MessageActions>
          )}

          {answered && isLast && !turn.feedback && !feedbackClosed && (
            <FeedbackBar
              className="jeffy-enter bg-card/60 w-full max-w-sm"
              title="Was this helpful?"
              onHelpful={() => onFeedback("up")}
              onNotHelpful={() => onFeedback("down")}
              onClose={() => setFeedbackClosed(true)}
            />
          )}
        </div>
      </Message>
    </div>
  );
}
