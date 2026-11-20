"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, ReplayIcon, StopIcon } from "./icons";
import type { VoiceEngine } from "./voice-engine";

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) return "0:00";
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const roundBtn =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 ease-out active:scale-95";

export function AudioPlayer({
  url,
  autoplay,
  onPlaying,
  onFailed,
}: {
  url: string;
  autoplay: boolean;
  onPlaying: (el: HTMLAudioElement) => void;
  onFailed: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const paint = () => {
    const el = audioRef.current;
    const fill = fillRef.current;
    if (!el || !fill) return;
    const d = el.duration;
    const p = Number.isFinite(d) && d > 0 ? Math.min(1, el.currentTime / d) : 0;
    fill.style.transform = `scaleX(${p})`;
  };

  // Per-frame progress goes straight to the DOM, not through React state.
  useEffect(() => {
    if (!playing) {
      paint();
      return;
    }
    const tick = () => {
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  useEffect(() => {
    if (!autoplay) return;
    audioRef.current?.play().catch((e: unknown) => {
      // Browsers may refuse autoplay without a recent gesture; show a clear tap-to-play state.
      if ((e as { name?: string })?.name !== "AbortError") setBlocked(true);
    });
  }, [autoplay]);

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

  return (
    <div className="jeffy-enter flex w-full max-w-sm items-center gap-2 rounded-2xl border border-line bg-raised p-2">
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        onPlay={(e) => {
          setPlaying(true);
          setBlocked(false);
          onPlaying(e.currentTarget);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={paint}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration);
          paint();
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onError={onFailed}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause reply" : "Play reply"}
        className={`${roundBtn} ${blocked ? "jeffy-dot " : ""}bg-cobalt text-white hover:bg-cobalt-press`}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="relative flex h-6 items-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-track">
            <div
              ref={fillRef}
              className="h-full origin-left rounded-full bg-accent"
              style={{ transform: "scaleX(0)" }}
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
              paint();
            }}
            className="absolute inset-x-0 -inset-y-2.5 h-11 w-full cursor-pointer opacity-0 focus-visible:outline-none"
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span className="tabular-nums">
            {blocked ? "Tap to play" : `${fmt(time)} / ${fmt(duration)}`}
          </span>
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

/** Same look as AudioPlayer, driven by the VoiceEngine while the reply is still being received. */
export function LivePlayer({ engine }: { engine: VoiceEngine }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(engine.paused);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pos = engine.position();
      const dur = engine.duration();
      // While chunks are still arriving the total is unknown, so leave headroom instead of pinning the bar full.
      const total = engine.receivedAll ? dur : dur + 3;
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${total > 0 ? Math.min(1, pos / total) : 0})`;
      }
      if (timeRef.current) {
        timeRef.current.textContent = engine.receivedAll ? `${fmt(pos)} / ${fmt(dur)}` : fmt(pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  useEffect(() => engine.subscribe(() => setPaused(engine.paused)), [engine]);

  return (
    <div className="jeffy-enter flex w-full max-w-sm items-center gap-2 rounded-2xl border border-line bg-raised p-2">
      <button
        type="button"
        onClick={() => (paused ? engine.resume() : engine.pause())}
        aria-label={paused ? "Resume reply" : "Pause reply"}
        className={`${roundBtn} bg-cobalt text-white hover:bg-cobalt-press`}
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-track">
            <div
              ref={fillRef}
              className="h-full origin-left rounded-full bg-accent"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
        </div>
        <div className="mt-0.5 text-xs text-ink-muted">
          <span ref={timeRef} className="tabular-nums">
            0:00
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => engine.stop()}
        aria-label="Stop reply"
        className={`${roundBtn} text-ink hover:bg-surface`}
      >
        <StopIcon />
      </button>
    </div>
  );
}
