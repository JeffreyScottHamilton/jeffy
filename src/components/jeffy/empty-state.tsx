"use client";

import { ArrowLeft, Code2, Compass, GraduationCap, Lightbulb, PenLine } from "lucide-react";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { ResponseStream } from "@/components/prompt-kit/response-stream";
import { cn } from "@/lib/utils";

export const SUGGESTION_GROUPS = [
  {
    label: "Write",
    icon: PenLine,
    highlight: "Write",
    items: [
      "Write a warm thank-you note to a mentor",
      "Write a crisp product announcement for a new feature",
      "Write a short story that ends with a twist",
      "Write a polite follow-up email after an interview",
    ],
  },
  {
    label: "Learn",
    icon: GraduationCap,
    highlight: "Explain",
    items: [
      "Explain how transformers work, simply",
      "Explain the difference between stocks and bonds",
      "Explain quantum entanglement with an analogy",
      "Explain why the sky is blue in two sentences",
    ],
  },
  {
    label: "Code",
    icon: Code2,
    highlight: "Help me",
    items: [
      "Help me write a debounce hook in TypeScript",
      "Help me design a REST API for a todo app",
      "Help me build a pricing card in JSX",
      "Help me understand this regex: ^(?=.*\\d).{8,}$",
    ],
  },
  {
    label: "Plan",
    icon: Compass,
    highlight: "Plan",
    items: [
      "Plan a 3-day trip to Lisbon on a budget",
      "Plan a week of healthy dinners",
      "Plan a study schedule for a big exam",
      "Plan a surprise birthday party",
    ],
  },
  {
    label: "Brainstorm",
    icon: Lightbulb,
    highlight: "Ideas",
    items: [
      "Ideas for a weekend side project",
      "Ideas for a team offsite that isn't boring",
      "Ideas for naming a coffee shop",
      "Ideas to make mornings less hectic",
    ],
  },
] as const;

const ALL = SUGGESTION_GROUPS.flatMap((g) => g.items);

export function Greeting({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="jeffy-orb-mini" aria-hidden />
      <ResponseStream
        textStream={text}
        mode="fade"
        speed={42}
        as="h1"
        className="text-foreground text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-[34px]"
      />
    </div>
  );
}

/** Category chips; a picked category (or typed text) shows matching prompts with the match highlighted. */
export function Suggestions({
  draft,
  category,
  onCategory,
  onPick,
}: {
  draft: string;
  category: string | null;
  onCategory: (c: string | null) => void;
  onPick: (prompt: string) => void;
}) {
  const typed = draft.trim();
  const group = SUGGESTION_GROUPS.find((g) => g.label === category);
  let items: readonly string[] = [];
  let highlight = "";
  if (group) {
    items = typed ? group.items.filter((s) => s.toLowerCase().includes(typed.toLowerCase())) : group.items;
    highlight = typed || group.highlight;
  } else if (typed.length >= 2) {
    items = ALL.filter((s) => s.toLowerCase().includes(typed.toLowerCase())).slice(0, 5);
    highlight = typed;
  }

  if (group || items.length > 0) {
    return (
      <div className="jeffy-enter flex w-full flex-col gap-0.5" role="list" aria-label="Suggested prompts">
        {group && (
          <button
            type="button"
            onClick={() => onCategory(null)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 mb-1 flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {group.label}
          </button>
        )}
        {items.map((s) => (
          <div role="listitem" key={s}>
            <PromptSuggestion
              highlight={highlight}
              onClick={() => onPick(s)}
              className="h-auto min-h-10 text-left text-[14.5px] whitespace-normal"
            >
              {s}
            </PromptSuggestion>
          </div>
        ))}
        {group && items.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">No matches. Press Enter to ask anyway.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-wrap justify-center gap-2" aria-label="Suggestion categories">
      {SUGGESTION_GROUPS.map((g, i) => (
        <PromptSuggestion
          key={g.label}
          size="sm"
          onClick={() => onCategory(g.label)}
          style={{ animationDelay: `${120 + i * 45}ms` }}
          className={cn(
            "jeffy-enter text-muted-foreground hover:text-foreground h-9 gap-2 rounded-full bg-transparent px-4 text-[13.5px] font-normal",
          )}
        >
          <g.icon className="size-4" aria-hidden />
          {g.label}
        </PromptSuggestion>
      ))}
    </div>
  );
}
