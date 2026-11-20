"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { ArrowDownIcon } from "@/components/jeffy/icons"
import { cn } from "@/lib/utils"
import { useStickToBottomContext } from "use-stick-to-bottom"

export type ScrollButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

function ScrollButton({ className, ...props }: ScrollButtonProps) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  return (
    <button
      type="button"
      aria-label="Scroll to latest message"
      tabIndex={isAtBottom ? -1 : 0}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full border border-line bg-raised text-ink transition-[transform,opacity] duration-200 ease-out hover:bg-surface active:scale-95",
        !isAtBottom
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-3 scale-95 opacity-0",
        className
      )}
      onClick={() => scrollToBottom()}
      {...props}
    >
      <ArrowDownIcon />
    </button>
  )
}

export { ScrollButton }
