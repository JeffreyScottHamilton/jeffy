"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AudioLines, ImageUp, Volume2, VolumeX } from "lucide-react";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/prompt-kit/chat-container";
import { FileUpload, FileUploadContent } from "@/components/prompt-kit/file-upload";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MAX_ATTACHMENTS,
  MAX_HISTORY_TURNS,
  type Attachment,
  type ChatErrorBody,
  type ChatEvent,
  type ChatMode,
  type ChatRequest,
} from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { ACCEPT, fitFiles, isImage, readAsDataUrl, type PendingFile } from "./attachments";
import { ChatSidebar } from "./chat-sidebar";
import { Composer } from "./composer";
import { Greeting, Suggestions } from "./empty-state";
import { GENERIC_MSG, NO_VOICE_MSG, applyEvent, createNdjsonParser, endOfStream, stopTurn } from "./events";
import { loadConversations, loadVoicePref, saveConversations, saveVoicePref, titleFrom } from "./storage";
import { TalkView } from "./talk-view";
import { TurnView } from "./turn-view";
import { newTurn, type Conversation, type Turn } from "./types";
import { VoiceEngine } from "./voice-engine";

const NETWORK_MSG = "Couldn't reach Jeffy. Check your connection and try again.";

function b64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}. What's on your mind?`;
}

const noopSubscribe = () => () => {};

/** Renders the chat only on the client, so the first client render can read localStorage without a mismatch. */
export function Chat() {
  const client = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!client) return <div className="bg-background h-dvh w-full" aria-busy="true" />;
  return <ChatApp />;
}

type RunOpts = { mode: ChatMode; voice: boolean; search: boolean; think: boolean; attachments: Attachment[] };

function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [search, setSearch] = useState(false);
  const [think, setThink] = useState(true);
  const [voice, setVoice] = useState(() => loadVoicePref());
  const [category, setCategory] = useState<string | null>(null);
  const [running, setRunning] = useState<{ convId: string; turnId: string; search: boolean } | null>(null);
  const [talkOpen, setTalkOpen] = useState(false);
  const [greeting] = useState(() => greetingFor(new Date()));
  const [engine] = useState(() => new VoiceEngine());

  const runningRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  /** Per-turn voice errors held until the audio that already arrived has played. */
  const voiceErrors = useRef(new Map<string, string>());
  /** Turns whose live voice was stopped by the user: later chunks are dropped. */
  const silenced = useRef(new Set<string>());
  const current = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  /** Attachment payloads kept in memory so Retry can resend them (never persisted). */
  const payloads = useRef(new Map<string, Attachment[]>());
  const composerRef = useRef<HTMLDivElement>(null);
  const talkButton = useRef<HTMLButtonElement>(null);
  const latest = useRef(conversations);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const turns = active?.turns ?? [];

  // Persist (debounced while streaming) and flush when the page is hidden.
  useEffect(() => {
    latest.current = conversations;
    const t = setTimeout(() => saveConversations(conversations), 400);
    return () => clearTimeout(t);
  }, [conversations]);
  useEffect(() => {
    const flush = () => saveConversations(latest.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

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

  const focusComposer = () =>
    requestAnimationFrame(() => {
      const el = composerRef.current?.querySelector("textarea");
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  const patch = (convId: string, turnId: string, fn: (t: Turn) => Turn) =>
    setConversations((cs) =>
      cs.map((c) => (c.id === convId ? { ...c, turns: c.turns.map((t) => (t.id === turnId ? fn(t) : t)) } : c)),
    );

  const revoke = (id: string) => {
    const old = urls.current.get(id);
    if (old) {
      URL.revokeObjectURL(old);
      urls.current.delete(id);
    }
  };

  const startLive = (convId: string, id: string) => {
    engine.begin(id, (r) => {
      const err = voiceErrors.current.get(id);
      voiceErrors.current.delete(id);
      if (err) {
        patch(convId, id, (t) => (t.voice.status === "live" ? { ...t, voice: { status: "error", message: err } } : t));
        return;
      }
      if (!r.complete) silenced.current.add(id);
      if (r.wav) {
        revoke(id);
        const url = URL.createObjectURL(r.wav);
        urls.current.set(id, url);
        patch(convId, id, (t) =>
          t.voice.status === "live" ? { ...t, voice: { status: "ready", url, autoplay: false } } : t,
        );
      } else {
        patch(convId, id, (t) => (t.voice.status === "live" ? { ...t, voice: { status: "none" } } : t));
      }
    });
  };

  const run = async (convId: string, id: string, question: string, before: Turn[], opts: RunOpts) => {
    const history = before
      .filter((t) => t.status === "done" && t.final)
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({ question: t.question, reply: t.final as string }));
    const body: ChatRequest = {
      question,
      history,
      mode: opts.mode,
      voice: opts.voice,
      search: opts.search,
      think: opts.think,
      ...(opts.attachments.length ? { attachments: opts.attachments } : {}),
    };
    const ctrl = new AbortController();
    abort.current = ctrl;
    runningRef.current = true;
    setRunning({ convId, turnId: id, search: opts.search });
    let reasoningStartedAt: number | undefined;

    const handle = (ev: ChatEvent) => {
      const now = Date.now();
      if (ev.type === "reasoning" && reasoningStartedAt === undefined) reasoningStartedAt = now;
      switch (ev.type) {
        case "audio_chunk":
          if (silenced.current.has(id)) return;
          if (engine.turnId !== id) startLive(convId, id);
          engine.push(b64ToBytes(ev.data), ev.sampleRate);
          break;
        case "audio_end":
          if (engine.turnId === id) engine.end();
          return;
        case "audio": {
          if (silenced.current.has(id)) return;
          revoke(id);
          let bytes: Uint8Array<ArrayBuffer>;
          try {
            bytes = b64ToBytes(ev.data);
          } catch {
            patch(convId, id, (t) => ({ ...t, voice: { status: "error", message: NO_VOICE_MSG } }));
            return;
          }
          const url = URL.createObjectURL(new Blob([bytes], { type: ev.mime }));
          urls.current.set(id, url);
          if (opts.mode === "talk") {
            // Talk mode speaks through the engine so the orb can follow the output level.
            patch(convId, id, (t) => ({ ...t, voice: { status: "ready", url, autoplay: false } }));
            void engine.playEncoded(id, bytes.slice().buffer, () => {});
          } else {
            patch(convId, id, (t) => ({ ...t, voice: { status: "ready", url, autoplay: true } }));
          }
          return;
        }
        case "audio_error":
          if (silenced.current.has(id)) return;
          if (engine.turnId === id) {
            voiceErrors.current.set(id, ev.message);
            engine.end();
            return;
          }
          break;
      }
      const ctx = { now, reasoningStartedAt, voice: opts.voice };
      patch(convId, id, (t) => applyEvent(t, ev, ctx));
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        let message = GENERIC_MSG;
        let retryable = true;
        try {
          const data = (await res.json()) as ChatErrorBody;
          if (typeof data?.error?.message === "string") message = data.error.message;
          if (typeof data?.error?.retryable === "boolean") retryable = data.error.retryable;
        } catch {
          /* keep generic */
        }
        handle({ type: "error", code: "internal", message, retryable });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createNdjsonParser(handle);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.flush();
      if (engine.turnId === id) engine.end(); // stream closed without audio_end: play out what arrived
      patch(convId, id, (t) => endOfStream(t, opts.voice));
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") {
        if (engine.turnId === id) engine.stop();
        patch(convId, id, stopTurn);
      } else {
        handle({ type: "error", code: "internal", message: NETWORK_MSG, retryable: true });
      }
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        runningRef.current = false;
        setRunning(null);
      }
    }
  };

  const ask = (
    question: string,
    {
      replaceId,
      mode = "text",
      attachments = [],
      meta = [],
    }: { replaceId?: string; mode?: ChatMode; attachments?: Attachment[]; meta?: Turn["attachments"] } = {},
  ): string | null => {
    if (runningRef.current) return null;
    // Runs inside the click/submit gesture, which is what lets the AudioContext start.
    engine.unlock();
    engine.stop();
    current.current?.pause();
    const now = Date.now();
    const convId = active?.id ?? crypto.randomUUID();
    const index = replaceId ? turns.findIndex((t) => t.id === replaceId) : turns.length;
    const before = turns.slice(0, Math.max(index, 0));
    const id = replaceId ?? crypto.randomUUID();
    const old = replaceId ? turns.find((t) => t.id === replaceId) : undefined;
    const payload = replaceId ? (payloads.current.get(id) ?? []) : attachments;
    if (!replaceId && attachments.length) payloads.current.set(id, attachments);
    silenced.current.delete(id);
    voiceErrors.current.delete(id);
    revoke(id);
    const fresh = newTurn(id, question, old?.attachments ?? meta);
    setConversations((cs) => {
      const existing = cs.find((c) => c.id === convId);
      if (!existing) {
        return [{ id: convId, title: titleFrom(question), createdAt: now, updatedAt: now, turns: [fresh] }, ...cs];
      }
      return cs.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              updatedAt: now,
              turns: replaceId ? c.turns.map((t) => (t.id === id ? fresh : t)) : [...c.turns, fresh],
            },
      );
    });
    setActiveId(convId);
    runningRef.current = true;
    const talk = mode === "talk";
    void run(convId, id, question, before, {
      mode,
      voice: talk || voice,
      search: talk ? false : search,
      think: talk ? false : think,
      attachments: payload,
    });
    return id;
  };

  const send = () => {
    const q = draft.trim();
    if (!q || runningRef.current) return;
    const atts = files.map(({ name, mime, data }) => ({ name, mime, data }));
    const meta = files.map(({ name, mime, previewUrl }) => (previewUrl ? { name, mime, previewUrl } : { name, mime }));
    if (ask(q, { attachments: atts, meta })) {
      setDraft("");
      setFiles([]);
      setWarning(null);
      setCategory(null);
    }
  };

  const stop = () => {
    abort.current?.abort();
    engine.stop();
  };

  const addFiles = async (picked: File[]) => {
    const { accepted, warning: warn } = fitFiles(files, picked);
    setWarning(warn);
    const read = await Promise.all(
      accepted.map(async ({ file, mime }): Promise<PendingFile | null> => {
        try {
          const url = await readAsDataUrl(file);
          const data = url.slice(url.indexOf(",") + 1);
          return {
            id: crypto.randomUUID(),
            name: file.name,
            mime,
            data,
            size: file.size,
            ...(isImage(mime) ? { previewUrl: url } : {}),
          };
        } catch {
          return null;
        }
      }),
    );
    const ok = read.filter((f): f is PendingFile => f !== null);
    if (ok.length) setFiles((prev) => [...prev, ...ok].slice(0, MAX_ATTACHMENTS));
    if (ok.length < accepted.length) setWarning("Some files couldn't be read.");
  };

  const toggleVoice = (on: boolean) => {
    setVoice(on);
    saveVoicePref(on);
    if (!on) {
      engine.stop();
      current.current?.pause();
    }
  };

  const newChat = () => {
    setActiveId(null);
    setCategory(null);
    focusComposer();
  };

  const deleteChat = (id: string) => {
    if (running?.convId === id) stop();
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const onPlaying = (el: HTMLAudioElement) => {
    engine.stop();
    if (current.current && current.current !== el) current.current.pause();
    current.current = el;
  };

  const composer = (
    <Composer
      rootRef={composerRef}
      value={draft}
      onValueChange={setDraft}
      onSubmit={send}
      onStop={stop}
      running={!!running}
      files={files}
      onRemoveFile={(fid) => setFiles((fs) => fs.filter((f) => f.id !== fid))}
      warning={warning}
      onDismissWarning={() => setWarning(null)}
      search={search}
      onSearchChange={setSearch}
      think={think}
      onThinkChange={setThink}
      voice={voice}
      onVoiceChange={toggleVoice}
    />
  );

  const empty = turns.length === 0;

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        runningId={running?.convId ?? null}
        onSelect={(id) => {
          setActiveId(id);
          setCategory(null);
        }}
        onNew={newChat}
        onDelete={deleteChat}
      />
      <SidebarInset className="jeffy-main relative h-dvh min-h-0 min-w-0 overflow-hidden">
        <FileUpload onFilesAdded={(f) => void addFiles(f)} accept={ACCEPT} disabled={talkOpen}>
          <FileUploadContent className="bg-background/70">
            <div className="jeffy-drop flex flex-col items-center gap-3 rounded-3xl border border-dashed px-14 py-12 text-center">
              <ImageUp className="text-primary size-8" aria-hidden />
              <p className="text-lg font-medium">Drop files to attach</p>
              <p className="text-muted-foreground text-sm">Images, PDF, text or markdown · up to 4 files, 3 MB</p>
            </div>
          </FileUploadContent>

          <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
            <SidebarTrigger aria-label="Toggle sidebar" className="text-muted-foreground hover:text-foreground size-9" />
            <h1 className="min-w-0 truncate text-[15px] font-medium tracking-tight">
              {active ? active.title : <span className="text-muted-foreground">New chat</span>}
            </h1>
            <div className="ml-auto flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-pressed={voice}
                    aria-label={voice ? "Voice replies on" : "Voice replies off"}
                    onClick={() => toggleVoice(!voice)}
                    className={cn(
                      "size-9 rounded-full",
                      voice ? "text-primary bg-primary/10 hover:bg-primary/15" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {voice ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{voice ? "Voice replies on" : "Speak replies out loud"}</TooltipContent>
              </Tooltip>
              <Button
                ref={talkButton}
                variant="outline"
                aria-label="Talk to Jeffy"
                onClick={() => {
                  engine.unlock();
                  setTalkOpen(true);
                }}
                className="h-9 gap-2 rounded-full px-3.5 text-[13px]"
              >
                <AudioLines className="size-4" />
                Talk
              </Button>
            </div>
          </header>

          {empty ? (
            <div className="jeffy-hero relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4">
              <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 pt-[4vh] pb-[12vh]">
                <Greeting text={greeting} />
                {composer}
                <div className="min-h-40 w-full">
                  <Suggestions
                    draft={draft}
                    category={category}
                    onCategory={setCategory}
                    onPick={(p) => {
                      setDraft(p);
                      setCategory(null);
                      focusComposer();
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <ChatContainerRoot className="relative min-h-0 flex-1">
                <ChatContainerContent className="mx-auto w-full max-w-3xl gap-10 px-4 pt-4 pb-12 sm:px-6">
                  {turns.map((t, i) => (
                    <TurnView
                      key={t.id}
                      turn={t}
                      engine={engine}
                      busy={!!running}
                      isLast={i === turns.length - 1}
                      searchRequested={running?.turnId === t.id && running.search}
                      onRegenerate={() => ask(t.question, { replaceId: t.id })}
                      onEdit={() => {
                        setDraft(t.question);
                        focusComposer();
                      }}
                      onStop={stop}
                      onFeedback={(f) => active && patch(active.id, t.id, (x) => ({ ...x, feedback: f }))}
                      onPlaying={onPlaying}
                      onVoiceFailed={() =>
                        active &&
                        patch(active.id, t.id, (x) => ({
                          ...x,
                          voice: { status: "error", message: "This reply couldn't play." },
                        }))
                      }
                    />
                  ))}
                  <ChatContainerScrollAnchor />
                </ChatContainerContent>
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <ScrollButton
                    aria-label="Scroll to latest"
                    className="bg-card/90 pointer-events-auto shadow-lg backdrop-blur"
                  />
                </div>
              </ChatContainerRoot>
              <div className="jeffy-dock relative z-10 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
                <div className="mx-auto w-full max-w-3xl">
                  {composer}
                  <p className="text-muted-foreground/70 mt-2 text-center text-[11px]">
                    Jeffy can make mistakes. Check important info.
                  </p>
                </div>
              </div>
            </>
          )}
        </FileUpload>
      </SidebarInset>
      {talkOpen && (
        <TalkView
          engine={engine}
          turns={turns}
          onUtterance={(text) => ask(text, { mode: "talk" })}
          onInterrupt={stop}
          onClose={() => {
            stop();
            setTalkOpen(false);
            requestAnimationFrame(() => talkButton.current?.focus());
          }}
        />
      )}
    </SidebarProvider>
  );
}
