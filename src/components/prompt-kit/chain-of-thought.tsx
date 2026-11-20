"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { Collapse } from "@/components/jeffy/collapse"
import { ChevronIcon } from "@/components/jeffy/icons"
import { cn } from "@/lib/utils"
import React, { createContext, useContext, useId, useState } from "react"

type StepContextType = { open: boolean; toggle: () => void; contentId: string }
const StepContext = createContext<StepContextType | undefined>(undefined)

function useStep() {
  const ctx = useContext(StepContext)
  if (!ctx) throw new Error("ChainOfThought parts must be used within a ChainOfThoughtStep")
  return ctx
}

export type ChainOfThoughtItemProps = React.ComponentProps<"div">

export const ChainOfThoughtItem = ({
  children,
  className,
  ...props
}: ChainOfThoughtItemProps) => (
  <div className={cn("text-sm text-ink-muted", className)} {...props}>
    {children}
  </div>
)

export type ChainOfThoughtTriggerProps = React.ComponentProps<"button"> & {
  leftIcon?: React.ReactNode
  /** Render a static label (nothing to expand). */
  disabled?: boolean
}

export const ChainOfThoughtTrigger = ({
  children,
  className,
  leftIcon,
  disabled,
  ...props
}: ChainOfThoughtTriggerProps) => {
  const { open, toggle, contentId } = useStep()
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-expanded={disabled ? undefined : open}
      aria-controls={disabled ? undefined : contentId}
      className={cn(
        "group flex min-h-8 items-center gap-2 rounded-md text-left text-sm text-ink-muted transition-colors enabled:cursor-pointer enabled:hover:text-ink",
        className
      )}
      {...props}
    >
      <span className="inline-flex size-4 items-center justify-center">
        {leftIcon ?? <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span>{children}</span>
      {!disabled && (
        <ChevronIcon
          className={cn("transition-transform duration-200 ease-out", open && "rotate-180")}
        />
      )}
    </button>
  )
}

export type ChainOfThoughtContentProps = React.ComponentProps<"div">

export const ChainOfThoughtContent = ({
  children,
  className,
}: ChainOfThoughtContentProps) => {
  const { open, contentId } = useStep()
  return (
    <Collapse open={open} id={contentId}>
      <div className="ml-2 border-l border-line pt-1 pb-2 pl-5">
        <div className={cn("space-y-1.5", className)}>{children}</div>
      </div>
    </Collapse>
  )
}

export type ChainOfThoughtProps = {
  children: React.ReactNode
  className?: string
}

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  return <div className={cn("space-y-0", className)}>{children}</div>
}

export type ChainOfThoughtStepProps = {
  children: React.ReactNode
  className?: string
  defaultOpen?: boolean
}

export const ChainOfThoughtStep = ({
  children,
  className,
  defaultOpen = false,
}: ChainOfThoughtStepProps) => {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  return (
    <StepContext.Provider value={{ open, toggle: () => setOpen((o) => !o), contentId }}>
      <div className={className}>{children}</div>
    </StepContext.Provider>
  )
}
