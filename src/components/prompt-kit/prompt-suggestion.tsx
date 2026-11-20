"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { cn } from "@/lib/utils"

export type PromptSuggestionProps = React.ButtonHTMLAttributes<HTMLButtonElement>

function PromptSuggestion({ children, className, ...props }: PromptSuggestionProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border border-line bg-raised px-4 text-left text-sm text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-surface active:scale-[0.98]",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { PromptSuggestion }
