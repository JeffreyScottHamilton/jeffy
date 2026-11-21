"use client";

import { useMemo, useState } from "react";
import { Brain, Globe, Lightbulb, Search } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from "@/components/prompt-kit/chain-of-thought";
import { Markdown } from "@/components/prompt-kit/markdown";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/prompt-kit/reasoning";
import { Steps, StepsContent, StepsItem, StepsTrigger } from "@/components/prompt-kit/steps";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Tool } from "@/components/prompt-kit/tool";
import type { SourceRef } from "@/lib/api-types";
import { splitReasoning } from "./reasoning-steps";

export function thoughtLabel(ms?: number): string {
  if (ms === undefined) return "Thought it through";
  const s = Math.max(1, Math.round(ms / 1000));
  return `Thought for ${s}s`;
}

/** Reasoning (auto-opens while thinking) with Gemini's bold-title paragraphs as chain-of-thought steps. */
export function ThinkingPanel({
  reasoning,
  thinking,
  reasoningMs,
}: {
  reasoning: string;
  /** Reasoning is still arriving and the answer hasn't started. */
  thinking: boolean;
  reasoningMs?: number;
}) {
  const steps = useMemo(() => splitReasoning(reasoning), [reasoning]);
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const activeIndex = thinking ? steps.length - 1 : -1;

  return (
    <Reasoning isStreaming={thinking} className="jeffy-enter">
      <ReasoningTrigger
        aria-label={thinking ? "Thinking, show reasoning" : "Show reasoning"}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 -ml-1 rounded-md px-1 py-0.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none [&>span]:text-inherit"
      >
        <span className="inline-flex items-center gap-2">
          <Brain className="size-4" aria-hidden />
          {thinking ? <TextShimmer>Thinking</TextShimmer> : <span>{thoughtLabel(reasoningMs)}</span>}
        </span>
      </ReasoningTrigger>
      <ReasoningContent className="ml-1" contentClassName="not-prose max-w-none pt-3">
        <ChainOfThought className="border-border/70 border-l pl-4">
          {steps.map((step, i) => {
            const active = i === activeIndex;
            const open = active || (opened[i] ?? false);
            return (
              <ChainOfThoughtStep
                key={i}
                open={open}
                onOpenChange={(o) => setOpened((m) => ({ ...m, [i]: o }))}
              >
                <ChainOfThoughtTrigger
                  leftIcon={<Lightbulb className="size-4" />}
                  className="focus-visible:ring-ring/60 rounded-md focus-visible:ring-2 focus-visible:outline-none"
                >
                  {active ? (
                    <TextShimmer>{step.title || "Thinking"}</TextShimmer>
                  ) : (
                    <span className="text-foreground/85">{step.title || "Thinking"}</span>
                  )}
                </ChainOfThoughtTrigger>
                {step.body && (
                  <ChainOfThoughtContent>
                    <ChainOfThoughtItem className="jeffy-thought prose prose-invert prose-sm max-w-none leading-6">
                      <Markdown>{step.body}</Markdown>
                    </ChainOfThoughtItem>
                  </ChainOfThoughtContent>
                )}
              </ChainOfThoughtStep>
            );
          })}
        </ChainOfThought>
      </ReasoningContent>
    </Reasoning>
  );
}

/** google_search as a prompt-kit Tool card plus the queries as Steps. */
export function SearchPanel({
  queries,
  sources,
  searching,
}: {
  queries: string[];
  sources: SourceRef[];
  searching: boolean;
}) {
  return (
    <div className="jeffy-enter flex flex-col gap-3">
      <Steps defaultOpen>
        <StepsTrigger
          leftIcon={<Globe className="size-4" />}
          className="focus-visible:ring-ring/60 w-auto rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          {searching ? <TextShimmer>Searching the web</TextShimmer> : <span>Searched the web</span>}
        </StepsTrigger>
        <StepsContent>
          {queries.map((q) => (
            <StepsItem key={q} className="flex items-start gap-2">
              <Search className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
              <span>
                Searching for <span className="text-foreground/90">&ldquo;{q}&rdquo;</span>
              </span>
            </StepsItem>
          ))}
          {!searching && sources.length > 0 && (
            <StepsItem className="flex items-center gap-2">
              <span className="bg-primary/70 size-1.5 rounded-full" aria-hidden />
              Found {sources.length} {sources.length === 1 ? "source" : "sources"}
            </StepsItem>
          )}
        </StepsContent>
      </Steps>
      <Tool
        className="jeffy-tool mt-0 max-w-xl"
        toolPart={{
          type: "google_search",
          state: searching ? "input-streaming" : "output-available",
          input: { queries: queries.join(" · ") },
          output: searching ? undefined : { sources: sources.length },
        }}
      />
    </div>
  );
}
