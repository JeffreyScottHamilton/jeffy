import "server-only";

/** Spoken text is capped so a long markdown answer does not turn into minutes of audio. */
export const MAX_SPOKEN_CHARS = 1500;

// Longest held-back fragment (an unclosed "[" or a URL with no end yet) before it is let through as plain text.
const MAX_HOLD = 500;
const URL_START = /^(?:https?:\/\/)/i;
const URL_PREFIXES = ["http://", "https://"];

type LineStart =
  | { kind: "wait" }
  | { kind: "fence"; char: string }
  | { kind: "drop" }
  | { kind: "table" }
  | { kind: "prefix"; consume: number } // a quote / bullet / task marker; more prefixes may follow
  | { kind: "text"; consume: number };

/** Decides what a line is from its start. `complete` = the whole line is known. */
function lineStart(line: string, complete: boolean): LineStart {
  const ws = /^[ \t]*/.exec(line)![0].length;
  const rest = line.slice(ws);
  if (!rest) return complete ? { kind: "text", consume: line.length } : { kind: "wait" };
  const fence = /^(`{3,}|~{3,})/.exec(rest);
  if (fence) return { kind: "fence", char: fence[1][0] };
  if (!complete && /^(`{1,2}|~{1,2})$/.test(rest)) return { kind: "wait" };
  if (rest[0] === "|") return complete ? { kind: "table" } : { kind: "wait" };
  if (/^[-*_=][-*_=\s]*$/.test(rest)) {
    if (!complete) return { kind: "wait" };
    if (/^(?:([-*_])(?:[ \t]*\1){2,}|=+|-+)[ \t]*$/.test(rest)) return { kind: "drop" };
  }
  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(rest);
  if (heading) {
    if (!complete && heading[0] === rest && !/[ \t]$/.test(rest)) return { kind: "wait" };
    return { kind: "text", consume: ws + heading[0].length };
  }
  const quote = /^>[ \t]?/.exec(rest);
  if (quote) return { kind: "prefix", consume: ws + quote[0].length };
  if (!complete && rest === "+") return { kind: "wait" };
  const bullet = /^[-*+][ \t]+/.exec(rest);
  if (bullet) return { kind: "prefix", consume: ws + bullet[0].length };
  const task = /^\[[ xX]\][ \t]+/.exec(rest);
  if (task) return { kind: "prefix", consume: ws + task[0].length };
  if (!complete && /^\[[ xX]?\]?$/.test(rest)) return { kind: "wait" };
  return { kind: "text", consume: ws };
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/**
 * Makes one line of inline markdown speakable. When the line is not complete, stops before anything that could
 * still turn into a link or URL and reports how much it consumed; the caller keeps the rest for later.
 */
function inline(seg: string, complete: boolean): { out: string; consumed: number } {
  let out = "";
  let i = 0;
  const hold = () => !complete && seg.length - i < MAX_HOLD;
  while (i < seg.length) {
    const c = seg[i];
    if (c === "`" || c === "*" || c === "_") {
      i++;
      continue;
    }
    if (c === "~") {
      if (seg[i + 1] === "~") {
        i += 2;
        continue;
      }
      if (i + 1 === seg.length && !complete) break;
    }
    if (c === "!") {
      if (seg[i + 1] === "[") {
        i++;
        continue;
      }
      if (i + 1 === seg.length && !complete) break;
    }
    if (c === "[") {
      const close = seg.indexOf("]", i + 1);
      if (close < 0) {
        if (hold()) break;
      } else if (close + 1 === seg.length) {
        if (hold()) break;
        out += inline(seg.slice(i + 1, close), true).out;
        i = close + 1;
        continue;
      } else if (seg[close + 1] === "(") {
        const end = seg.indexOf(")", close + 2);
        if (end >= 0) {
          out += inline(seg.slice(i + 1, close), true).out;
          i = end + 1;
          continue;
        }
        if (hold()) break;
      } else {
        out += inline(seg.slice(i + 1, close), true).out;
        i = close + 1;
        continue;
      }
    }
    if (c === "<") {
      const rest = seg.slice(i + 1);
      if (URL_START.test(rest)) {
        const end = seg.indexOf(">", i + 1);
        if (end >= 0) {
          i = end + 1;
          continue;
        }
        if (hold()) break;
      } else if (!complete && URL_PREFIXES.some((p) => p.startsWith(rest.toLowerCase()))) {
        break;
      }
    }
    if ((c === "h" || c === "H") && !isWordChar(seg[i - 1])) {
      const rest = seg.slice(i);
      if (URL_START.test(rest)) {
        const ws = rest.search(/\s/);
        if (ws >= 0) {
          i += ws;
          continue;
        }
        if (hold()) break;
        i = seg.length;
        continue;
      }
      if (!complete && URL_PREFIXES.some((p) => p.startsWith(rest.toLowerCase()))) break;
    }
    out += c;
    i++;
  }
  return { out, consumed: i };
}

/**
 * Streaming markdown -> speakable text. `push` returns what can be spoken now; `end` flushes the rest.
 * Fenced code blocks are skipped (even when fences span deltas); emphasis, inline code, heading, quote, bullet and
 * table markers are removed; [text](url) becomes text; bare URLs are dropped; output is capped at MAX_SPOKEN_CHARS.
 */
export class SpeechFilter {
  private buf = "";
  private mode: "start" | "inline" | "skip" = "start";
  private fence: string | null = null;
  private spoken = 0;
  private last = ""; // last emitted char ("" = nothing yet)

  push(delta: string): string {
    if (this.spoken >= MAX_SPOKEN_CHARS) return "";
    this.buf += delta;
    return this.drain(false);
  }

  end(): string {
    if (this.spoken >= MAX_SPOKEN_CHARS) return "";
    const out = this.drain(true);
    this.buf = "";
    return out;
  }

  private emit(s: string, acc: string[]): void {
    for (const ch of s) {
      if (this.spoken >= MAX_SPOKEN_CHARS) return;
      if (ch === "\n") {
        if (!this.last || this.last === "\n") continue;
      } else if (!this.last && /\s/.test(ch)) continue;
      acc.push(ch);
      this.last = ch;
      this.spoken++;
    }
  }

  private drain(final: boolean): string {
    const acc: string[] = [];
    while (this.buf && this.spoken < MAX_SPOKEN_CHARS) {
      const nl = this.buf.indexOf("\n");
      const lineEnd = nl < 0 ? this.buf.length : nl;
      const complete = nl >= 0 || final;

      if (this.mode === "skip") {
        if (nl < 0) {
          this.buf = "";
          break;
        }
        this.buf = this.buf.slice(nl + 1);
        this.mode = "start";
        continue;
      }

      if (this.mode === "start") {
        const line = this.buf.slice(0, lineEnd);
        if (this.fence) {
          const t = line.trimStart();
          const close = this.fence.repeat(3);
          if (!complete && t.length < 3 && close.startsWith(t)) break;
          if (t.startsWith(close)) this.fence = null;
          this.mode = "skip";
          continue;
        }
        const d = lineStart(line, complete);
        if (d.kind === "wait") break;
        if (d.kind === "fence") {
          this.fence = d.char;
          this.mode = "skip";
        } else if (d.kind === "drop") {
          this.mode = "skip";
        } else if (d.kind === "table") {
          const cells = line
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean);
          const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
          if (!isSeparator) this.emit(inline(cells.join(", "), true).out + (nl >= 0 ? "\n" : ""), acc);
          this.mode = "skip";
        } else if (d.kind === "prefix") {
          this.buf = this.buf.slice(d.consume);
        } else {
          this.buf = this.buf.slice(d.consume);
          this.mode = "inline";
        }
        continue;
      }

      // inline
      const seg = this.buf.slice(0, lineEnd);
      const r = inline(seg, complete);
      this.emit(r.out, acc);
      this.buf = this.buf.slice(r.consumed);
      if (r.consumed < seg.length) break; // holding back a possible link / URL
      if (nl < 0) break;
      this.buf = this.buf.slice(1);
      this.emit("\n", acc);
      this.mode = "start";
    }
    return acc.join("");
  }
}

/** Whole-reply convenience for non-streaming voices. */
export function toSpeech(markdown: string): string {
  const f = new SpeechFilter();
  return (f.push(markdown) + f.end()).trim();
}
