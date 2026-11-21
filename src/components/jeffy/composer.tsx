"use client";

import { ArrowUp, Brain, FileText, Globe, Paperclip, Square, Volume2, VolumeX, X } from "lucide-react";
import { FileUploadTrigger } from "@/components/prompt-kit/file-upload";
import { Image } from "@/components/prompt-kit/image";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/prompt-kit/prompt-input";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { Button } from "@/components/ui/button";
import { MAX_ATTACHMENTS, MAX_QUESTION_CHARS } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { formatBytes, isImage, splitDataUrl, type PendingFile } from "./attachments";

const toggleCls = (on: boolean) =>
  cn(
    "h-9 rounded-full px-3 text-[13px] font-medium transition-[background-color,border-color,color] duration-150",
    on
      ? "border-primary/45 bg-primary/15 text-[oklch(0.8_0.11_266)] hover:bg-primary/20 hover:text-[oklch(0.85_0.1_266)]"
      : "text-muted-foreground hover:text-foreground bg-transparent",
  );

export function Composer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  running,
  files,
  onRemoveFile,
  warning,
  onDismissWarning,
  search,
  onSearchChange,
  think,
  onThinkChange,
  voice,
  onVoiceChange,
  rootRef,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  files: PendingFile[];
  onRemoveFile: (id: string) => void;
  warning: string | null;
  onDismissWarning: () => void;
  search: boolean;
  onSearchChange: (v: boolean) => void;
  think: boolean;
  onThinkChange: (v: boolean) => void;
  voice: boolean;
  onVoiceChange: (v: boolean) => void;
  rootRef?: React.Ref<HTMLDivElement>;
  className?: string;
}) {
  const canSend = value.trim().length > 0 && !running;
  const near = value.length >= MAX_QUESTION_CHARS - 200;

  return (
    <div ref={rootRef} className={cn("flex w-full flex-col gap-2", className)}>
      {warning && (
        <SystemMessage
          variant="warning"
          fill
          role="alert"
          className="jeffy-enter text-amber-300/95 dark:text-amber-300/95"
          cta={{ label: "Dismiss", onClick: onDismissWarning }}
        >
          {warning}
        </SystemMessage>
      )}
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={() => canSend && onSubmit()}
        isLoading={running}
        maxHeight={260}
        className="jeffy-composer bg-card/90 relative z-10 w-full rounded-[26px] border p-0 pt-1 backdrop-blur-xl"
      >
        {files.length > 0 && (
          <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-3 pt-2">
            {files.map((f) => {
              const img = f.previewUrl ? splitDataUrl(f.previewUrl) : null;
              return (
                <li
                  key={f.id}
                  className="jeffy-enter bg-secondary/80 group/chip relative flex h-14 max-w-56 items-center gap-2.5 rounded-xl border p-1.5 pr-8"
                >
                  {isImage(f.mime) && img ? (
                    <Image
                      base64={img.base64}
                      mediaType={img.mediaType}
                      alt={f.name}
                      className="size-11 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="bg-primary/15 text-primary flex size-11 shrink-0 items-center justify-center rounded-lg">
                      <FileText className="size-5" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{f.name}</span>
                    <span className="text-muted-foreground block text-[11px]">
                      {f.mime === "application/pdf" ? "PDF" : isImage(f.mime) ? "Image" : "Text"} ·{" "}
                      {formatBytes(f.size)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(f.id);
                    }}
                    className="bg-background/80 text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1 right-1 flex size-6 items-center justify-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <PromptInputTextarea
          placeholder="Ask Jeffy anything…"
          aria-label="Message Jeffy"
          maxLength={MAX_QUESTION_CHARS}
          className="text-foreground placeholder:text-muted-foreground/80 min-h-[48px] px-4 pt-3 text-base leading-[1.45] md:text-base"
        />
        <PromptInputActions className="flex w-full items-center justify-between gap-2 px-2.5 pt-2 pb-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <PromptInputAction tooltip={files.length >= MAX_ATTACHMENTS ? `Up to ${MAX_ATTACHMENTS} files` : "Attach files"}>
              <FileUploadTrigger asChild aria-label="Attach files">
                <Button variant="outline" size="icon" className="text-muted-foreground hover:text-foreground size-9 rounded-full bg-transparent">
                  <Paperclip className="size-[18px]" />
                </Button>
              </FileUploadTrigger>
            </PromptInputAction>
            <PromptInputAction tooltip={search ? "Web search on" : "Search the web"}>
              <Button
                variant="outline"
                aria-pressed={search}
                aria-label="Search the web"
                onClick={() => onSearchChange(!search)}
                className={toggleCls(search)}
              >
                <Globe className="size-4" />
                <span className="hidden sm:inline">Search</span>
              </Button>
            </PromptInputAction>
            <PromptInputAction tooltip={think ? "Shows its reasoning" : "Answer without visible reasoning"}>
              <Button
                variant="outline"
                aria-pressed={think}
                aria-label="Think before answering"
                onClick={() => onThinkChange(!think)}
                className={toggleCls(think)}
              >
                <Brain className="size-4" />
                <span className="hidden sm:inline">Think</span>
              </Button>
            </PromptInputAction>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {near && (
              <span className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
                {value.length}/{MAX_QUESTION_CHARS}
              </span>
            )}
            <PromptInputAction tooltip={voice ? "Voice replies on" : "Voice replies off"}>
              <Button
                variant="ghost"
                size="icon"
                aria-pressed={voice}
                aria-label="Speak replies"
                onClick={() => onVoiceChange(!voice)}
                className={cn(
                  "size-9 rounded-full",
                  voice ? "text-primary bg-primary/10 hover:bg-primary/15" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {voice ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
              </Button>
            </PromptInputAction>
            {running ? (
              <PromptInputAction tooltip="Stop">
                <Button
                  size="icon"
                  aria-label="Stop answering"
                  onClick={onStop}
                  className="bg-foreground text-background hover:bg-foreground/90 size-9 rounded-full"
                >
                  <Square className="size-3.5" fill="currentColor" />
                </Button>
              </PromptInputAction>
            ) : (
              <PromptInputAction tooltip="Send">
                <Button
                  size="icon"
                  aria-label="Send message"
                  disabled={!canSend}
                  onClick={onSubmit}
                  className="jeffy-send size-9 rounded-full disabled:opacity-30"
                >
                  <ArrowUp className="size-[18px]" />
                </Button>
              </PromptInputAction>
            )}
          </div>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
}
