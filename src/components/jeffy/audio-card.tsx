"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, ReplayIcon } from "./icons";

export type TurnStatus = "pending" | "ready" | "error";

export type Turn = {
  id: string;
  question: string;
  status: TurnStatus;
  audioUrl?: string;
  reply?: string;
  error?: string;
  autoplay?: boolean;
};

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const roundBtn =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors";

export function AudioCard({
  turn,
  onRetry,
  onPlaying,
}: {
  turn: Turn;
  onRetry: () => void;
  onPlaying: (el: HTMLAudioElement) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const { audioUrl, autoplay, status } = turn;

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioUrl || !autoplay) return;
    el.play().catch(() => {
      /* autoplay blocked (NotAllowedError): stay paused, no error */
    });
  }, [audioUrl, autoplay]);

  const shell =
    "jeffy-enter flex min-h-16 items-center gap-3 rounded-2xl border border-line py-2";

  if (status === "pending") {
    return (
      <div className={`${shell} px-4`} role="status" aria-live="polite">
        <span className="jeffy-pulse text-sm text-ink-muted">
          Jeffy is thinking…
        </span>
      </div>
    );
  }

  if (status === "error" || failed) {
    const message = failed ? "This reply couldn't play." : turn.error;
    return (
      <div className={`${shell} justify-between px-4`} role="alert">
        <span className="text-sm text-danger">{message}</span>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            onRetry();
          }}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-surface"
        >
          Try again
        </button>
      </div>
    );
  }

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  const replay = () => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  };
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={`${shell} w-full max-w-sm px-2`}>
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="auto"
        onPlay={(e) => {
          setPlaying(true);
          onPlaying(e.currentTarget);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause reply" : "Play reply"}
        className={`${roundBtn} bg-cobalt text-white hover:bg-cobalt-press active:bg-cobalt-press`}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-6 items-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cobalt">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full bg-cobalt"
              style={{ width: `${pct}%` }}
            />
          </div>
          <input
            type="range"
            aria-label="Playback position"
            min={0}
            max={duration > 0 ? duration : 0}
            step="any"
            value={Math.min(time, duration || 0)}
            disabled={!(duration > 0)}
            onChange={(e) => {
              const el = audioRef.current;
              const v = Number(e.target.value);
              if (el) el.currentTime = v;
              setTime(v);
            }}
            className="absolute inset-x-0 -inset-y-2.5 h-11 w-full cursor-pointer opacity-0 focus-visible:outline-none"
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span className="tabular-nums">
            {fmt(time)} / {fmt(duration)}
          </span>
          <span className="whitespace-nowrap">AI-generated voice</span>
        </div>
      </div>
      <button
        type="button"
        onClick={replay}
        aria-label="Replay from start"
        className={`${roundBtn} text-ink hover:bg-surface`}
      >
        <ReplayIcon />
      </button>
    </div>
  );
}
