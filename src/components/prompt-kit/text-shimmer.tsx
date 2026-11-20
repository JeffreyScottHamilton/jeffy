"use client"
// Adapted from prompt-kit (https://github.com/ibelick/prompt-kit, MIT, commit 5a94966): same API shape, without the shadcn/lucide/markdown dependencies.

import { cn } from "@/lib/utils"

export type TextShimmerProps = {
  as?: string
  duration?: number
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>

// Shimmer is a CSS gradient sweep (.jeffy-shimmer in globals.css); no animation library needed.
export function TextShimmer({
  as = "span",
  className,
  duration = 2.2,
  children,
  style,
  ...props
}: TextShimmerProps) {
  const Component = as as React.ElementType
  return (
    <Component
      className={cn("jeffy-shimmer font-medium", className)}
      style={{ animationDuration: `${duration}s`, ...style }}
      {...props}
    >
      {children}
    </Component>
  )
}
