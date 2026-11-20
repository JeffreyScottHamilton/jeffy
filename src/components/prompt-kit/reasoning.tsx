"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { Collapse } from "@/components/jeffy/collapse"
import { ChevronIcon } from "@/components/jeffy/icons"
import { cn } from "@/lib/utils"
import React, { createContext, useContext, useId, useState } from "react"

type ReasoningContextType = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  contentId: string
}

const ReasoningContext = createContext<ReasoningContextType | undefined>(
  undefined
)

function useReasoningContext() {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error("useReasoningContext must be used within a Reasoning provider")
  }
  return context
}

export type ReasoningProps = {
  children: React.ReactNode
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isStreaming?: boolean
}

// Opens when streaming starts and collapses when it ends. Adjusting state during render
// (rather than in an effect) keeps it to a single paint.
function Reasoning({
  children,
  className,
  open,
  onOpenChange,
  isStreaming = false,
}: ReasoningProps) {
  const contentId = useId()
  const [internalOpen, setInternalOpen] = useState(isStreaming)
  const [prevStreaming, setPrevStreaming] = useState(isStreaming)
  if (prevStreaming !== isStreaming) {
    setPrevStreaming(isStreaming)
    setInternalOpen(isStreaming)
  }

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen

  const handleOpenChange = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <ReasoningContext.Provider
      value={{ isOpen, onOpenChange: handleOpenChange, contentId }}
    >
      <div className={className}>{children}</div>
    </ReasoningContext.Provider>
  )
}

export type ReasoningTriggerProps = {
  children: React.ReactNode
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>

function ReasoningTrigger({
  children,
  className,
  ...props
}: ReasoningTriggerProps) {
  const { isOpen, onOpenChange, contentId } = useReasoningContext()
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={contentId}
      className={cn(
        "flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md text-sm text-ink-muted transition-colors hover:text-ink",
        className
      )}
      onClick={() => onOpenChange(!isOpen)}
      {...props}
    >
      <span>{children}</span>
      <ChevronIcon
        className={cn(
          "transition-transform duration-200 ease-out",
          isOpen && "rotate-180"
        )}
      />
    </button>
  )
}

export type ReasoningContentProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

function ReasoningContent({
  children,
  className,
  contentClassName,
}: ReasoningContentProps) {
  const { isOpen, contentId } = useReasoningContext()
  return (
    <Collapse open={isOpen} id={contentId} className={className}>
      <div className={cn("text-sm text-ink-muted", contentClassName)}>
        {children}
      </div>
    </Collapse>
  )
}

export { Reasoning, ReasoningTrigger, ReasoningContent }
