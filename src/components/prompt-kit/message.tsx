"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { cn } from "@/lib/utils"

export type MessageProps = React.HTMLAttributes<HTMLDivElement>

const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
    {children}
  </div>
)

export type MessageContentProps = React.HTMLAttributes<HTMLDivElement>

const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn("min-w-0 break-words whitespace-pre-wrap text-ink", className)}
    {...props}
  >
    {children}
  </div>
)

export type MessageActionsProps = React.HTMLAttributes<HTMLDivElement>

const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1 text-ink-muted", className)} {...props}>
    {children}
  </div>
)

export type MessageActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name and native tooltip. */
  label: string
}

const MessageAction = ({ label, className, children, ...props }: MessageActionProps) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      "inline-flex size-9 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-out enabled:hover:bg-surface enabled:hover:text-ink enabled:active:scale-95 disabled:opacity-40",
      className
    )}
    {...props}
  >
    {children}
  </button>
)

export { Message, MessageContent, MessageActions, MessageAction }
