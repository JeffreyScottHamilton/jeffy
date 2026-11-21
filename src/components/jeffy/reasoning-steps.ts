export type ReasoningStep = { title: string; body: string };

/**
 * Gemini thought summaries arrive as `**Title**\n\nbody` paragraphs. A title is a bold run that sits on its own
 * line (or is glued right after a sentence end) and is followed by a newline or the end of the text.
 */
const TITLE = /(^|\n|(?<=[.!?:)]))[ \t]*\*\*([^*\n]{1,160})\*\*[ \t]*(?=\n|$)/g;

export function splitReasoning(text: string): ReasoningStep[] {
  if (!text.trim()) return [];
  const steps: ReasoningStep[] = [];
  let lastTitle: string | null = null;
  let cursor = 0;
  const push = (title: string | null, body: string) => {
    const b = body.trim();
    if (title === null && !b) return;
    steps.push({ title: title ?? "", body: b });
  };
  for (const m of text.matchAll(TITLE)) {
    const start = (m.index ?? 0) + m[1].length;
    push(lastTitle, text.slice(cursor, start));
    lastTitle = m[2].trim();
    cursor = (m.index ?? 0) + m[0].length;
  }
  let rest = text.slice(cursor);
  // A title still streaming in: "…\n\n**Checking sour"
  const partial = rest.match(/(^|\n)[ \t]*\*\*([^*\n]+)$/);
  if (partial && partial.index !== undefined) {
    push(lastTitle, rest.slice(0, partial.index));
    lastTitle = partial[2].trim();
    rest = "";
  }
  push(lastTitle, rest);
  return steps;
}
