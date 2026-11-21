"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MAX_QUESTION_CHARS } from "@/lib/api-types";
import { Mic, MicOff, X } from "lucide-react";
import type { Turn } from "./types";
import type { VoiceEngine } from "./voice-engine";

/** Minimal slice of the Web Speech API that is used here (not in lib.dom). */
type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const SILENCE_MS = 700;
const BARGE_RMS = 0.07;
const BARGE_MS = 250;

type Phase = "listening" | "thinking" | "speaking";
type MicState = "pending" | "ok" | "denied" | "unavailable";

const LABEL: Record<Phase, string> = {
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking",
};

const roundBtn =
  "inline-flex size-14 items-center justify-center rounded-full transition-[background-color,transform] duration-150 ease-out active:scale-95";

export function TalkView({
  engine,
  turns,
  onUtterance,
  onInterrupt,
  onClose,
}: {
  engine: VoiceEngine;
  turns: Turn[];
  /** Sends a spoken question; returns the new turn id, or null when a request is already running. */
  onUtterance: (text: string) => string | null;
  onInterrupt: () => void;
  onClose: () => void;
}) {
  const [Recognition] = useState(recognitionCtor);
  const [mic, setMic] = useState<MicState>(Recognition ? "pending" : "ok");
  const [muted, setMuted] = useState(false);
  const [heard, setHeard] = useState("");
  const [netNotice, setNetNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const speaking = useSyncExternalStore(engine.subscribe, () => engine.active, () => false);

  const orbRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const cb = useRef({ onUtterance, onInterrupt, onClose });
  useEffect(() => {
    cb.current = { onUtterance, onInterrupt, onClose };
  });

  const active = activeId ? turns.find((t) => t.id === activeId) : undefined;
  const finished =
    !!active && active.status !== "streaming" && active.voice.status !== "pending" && active.voice.status !== "live";
  let phase: Phase = "listening";
  if (active) phase = speaking ? "speaking" : finished ? "listening" : "thinking";
  const listening = phase === "listening" && !muted && mic === "ok" && !!Recognition;

  // Microphone: one stream for the whole session, used for the orb level and barge-in.
  useEffect(() => {
    if (!Recognition) return;
    let cancelled = false;
    let source: MediaStreamAudioSourceNode | null = null;
    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      queueMicrotask(() => !cancelled && setMic("unavailable"));
      return;
    }
    devices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStream.current = stream;
        const ctx = engine.unlock();
        if (ctx) {
          source = ctx.createMediaStreamSource(stream);
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          source.connect(an); // analysis only: never routed to the speakers
          micAnalyser.current = an;
        }
        setMic("ok");
      })
      .catch(() => !cancelled && setMic("denied"));
    return () => {
      cancelled = true;
      source?.disconnect();
      micAnalyser.current = null;
      micStream.current?.getTracks().forEach((t) => t.stop());
      micStream.current = null;
    };
  }, [Recognition, engine]);

  useEffect(() => {
    micStream.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, [muted, mic]);

  // Speech recognition runs only while listening, so Jeffy never hears itself.
  useEffect(() => {
    if (!listening || !Recognition) return;
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let stopped = false;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let restart: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    };
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.trim();
      setHeard(text);
      clearTimeout(silence);
      if (!text) return;
      silence = setTimeout(() => {
        stopped = true;
        rec.abort();
        const id = cb.current.onUtterance(Array.from(text).slice(0, MAX_QUESTION_CHARS).join(""));
        setHeard("");
        if (id) {
          setNetNotice(null);
          setActiveId(id);
        } else {
          stopped = false;
          start();
        }
      }, SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        stopped = true;
        setMic("denied");
      } else if (e.error === "network") {
        setNetNotice("Speech recognition lost its connection. Still trying…");
      }
    };
    rec.onend = () => {
      if (!stopped) restart = setTimeout(start, 300); // Chrome ends sessions after a while
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(silence);
      clearTimeout(restart);
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* not started */
      }
    };
  }, [listening, Recognition]);

  // Barge-in: sustained speech over Jeffy's voice stops it and goes back to listening.
  useEffect(() => {
    if (phase !== "speaking" || muted || mic !== "ok") return;
    const buf = new Float32Array(1024);
    let since = 0;
    const id = setInterval(() => {
      const an = micAnalyser.current;
      if (!an) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      if (Math.sqrt(sum / buf.length) > BARGE_RMS) {
        since ||= performance.now();
        if (performance.now() - since >= BARGE_MS) {
          clearInterval(id);
          cb.current.onInterrupt();
          setActiveId(null);
        }
      } else since = 0;
    }, 40);
    return () => clearInterval(id);
  }, [phase, muted, mic]);

  // Orb: level goes straight to a CSS variable each frame, not through React state.
  useEffect(() => {
    let raf = 0;
    let lvl = 0;
    const buf = new Float32Array(1024);
    const tick = () => {
      let target = 0;
      if (phase === "speaking") target = engine.level();
      else if (phase === "listening" && !muted && micAnalyser.current) {
        micAnalyser.current.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      }
      lvl += (target - lvl) * 0.25;
      orbRef.current?.style.setProperty("--lvl", lvl.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, muted, engine]);

  // Dialog behavior: focus in, Escape closes, Tab stays inside.
  useEffect(() => {
    endRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cb.current.onClose();
      } else if (e.key === "Tab") {
        const els = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!els?.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A finished turn hands the floor back to the listener; its failure, if any, is shown as a notice.
  const shown = active;
  const turnNotice = finished ? (active?.status === "error" ? active.error?.message : active?.voice.status === "error" ? active.voice.message : null) : null;
  const notice = turnNotice ?? netNotice;
  const problem =
    !Recognition
      ? "Talk mode needs speech recognition, which this browser doesn't have. Try Chrome, Edge or Safari."
      : mic === "denied"
        ? "I can't hear you. Allow microphone access for this site in your browser settings, then open Talk again."
        : mic === "unavailable"
          ? "This browser can't use the microphone here. Try again in Chrome, Edge or Safari over https."
          : null;

  const label = problem ? null : muted && phase === "listening" ? "Muted" : mic === "pending" ? "Starting…" : LABEL[phase];
  const visual = problem ? "idle" : muted && phase === "listening" ? "muted" : phase;

  let caption: React.ReactNode = null;
  if (!problem) {
    if (phase === "listening") {
      if (heard) caption = <p className="text-xl text-ink">{heard}</p>;
      else if (notice) caption = <p className="text-base text-danger">{notice}</p>;
      else if (shown?.text) caption = <p className="line-clamp-4 text-lg text-ink-muted">{shown.text}</p>;
      else caption = <p className="text-lg text-ink-muted">Just start talking.</p>;
    } else if (shown) {
      caption = (
        <>
          <p className="line-clamp-2 text-sm text-ink-muted">{shown.question}</p>
          {shown.text && <p className="mt-2 line-clamp-5 text-xl text-ink">{shown.text}</p>}
        </>
      );
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Talk to Jeffy"
      className="jeffy-enter fixed inset-0 z-50 flex flex-col items-center bg-paper px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center gap-8">
        <div ref={orbRef} className="jeffy-orb" data-state={visual} aria-hidden="true">
          <span className="jeffy-orb-halo" />
          <span className="jeffy-orb-core" />
          <span className="jeffy-orb-blob jeffy-orb-blob-a" />
          <span className="jeffy-orb-blob jeffy-orb-blob-b" />
        </div>
        <div className="flex min-h-40 w-full flex-col items-center gap-3 text-center">
          {label && (
            <p role="status" aria-live="polite" className="text-sm font-medium tracking-wide text-ink-muted">
              {label}
            </p>
          )}
          {problem && (
            <p role="alert" className="max-w-sm text-base text-ink">
              {problem}
            </p>
          )}
          <div className="w-full text-balance [overflow-wrap:anywhere]">{caption}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-6 pt-4">
        {!problem && (
          <button
            type="button"
            aria-pressed={muted}
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            onClick={() => setMuted((m) => !m)}
            className={`${roundBtn} ${muted ? "bg-ink text-paper" : "bg-surface text-ink hover:bg-track"}`}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
        <button
          ref={endRef}
          type="button"
          aria-label="End talk mode"
          onClick={() => cb.current.onClose()}
          className={`${roundBtn} bg-cobalt text-white hover:bg-cobalt-press`}
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
