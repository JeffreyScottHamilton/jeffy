import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, SpeechFilter, toSpeech } from "./speakable";

/** Feeds `deltas` through one filter and returns everything it produced. */
function run(deltas: string[]): string {
  const f = new SpeechFilter();
  let out = "";
  for (const d of deltas) out += f.push(d);
  return out + f.end();
}
const perChar = (s: string) => run(Array.from(s));
const chunks = (s: string, n: number) => run(s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) ?? []);

/** Every split of the input must speak the same text as the whole input. */
function speaks(md: string, expected: string) {
  expect(run([md])).toBe(expected);
  expect(perChar(md)).toBe(expected);
  for (const n of [2, 3, 5, 7, 13]) expect(chunks(md, n)).toBe(expected);
  for (let i = 1; i < md.length; i++) expect(run([md.slice(0, i), md.slice(i)])).toBe(expected);
}

describe("SpeechFilter", () => {
  it("passes plain text through", () => {
    speaks("Hello there, friend. How are you?", "Hello there, friend. How are you?");
  });
  it("removes emphasis and inline code markers", () => {
    speaks("This is **bold**, *it*, __u__ and `code`.", "This is bold, it, u and code.");
    speaks("~~old~~ new", "old new");
  });
  it("skips fenced code blocks, including tilde fences and language tags", () => {
    speaks("Run this:\n```ts\nconst x = 1;\nconsole.log(x);\n```\nThen done.", "Run this:\nThen done.");
    speaks("A\n~~~\nsecret code\n~~~\nB", "A\nB");
    speaks("Before\n  ```\n  indented fence\n  ```\nAfter", "Before\nAfter");
  });
  it("skips an unterminated fence to the end", () => {
    speaks("Look:\n```python\nprint('hi')\nmore", "Look:\n");
  });
  it("does not end a fence on a line that only starts with backticks", () => {
    speaks("x\n```\na\n`` not a fence\n```\ny", "x\ny");
  });
  it("strips heading markers, quotes and bullets", () => {
    speaks("# Title\n## Sub heading\nText", "Title\nSub heading\nText");
    speaks("> quoted line\n> > nested", "quoted line\nnested");
    speaks("- one\n* two\n+ three\n- [ ] task\n- [x] done", "one\ntwo\nthree\ntask\ndone");
    speaks("1. first\n2. second", "1. first\n2. second");
  });
  it("keeps text that only looks like markdown", () => {
    speaks("#hashtag and -5 degrees", "#hashtag and -5 degrees");
    speaks("-5 degrees", "-5 degrees");
    speaks("*Italic start* here", "Italic start here");
  });
  it("drops horizontal rules and setext underlines", () => {
    speaks("Above\n---\nBelow\n***\nEnd", "Above\nBelow\nEnd");
    speaks("Title\n=====\nBody", "Title\nBody");
  });
  it("turns table rows into comma-separated cells and drops the separator", () => {
    speaks("| Name | Age |\n| --- | :-: |\n| **Ann** | 3 |", "Name, Age\nAnn, 3");
  });
  it("replaces links with their text and drops images to alt text", () => {
    speaks("See [the docs](https://example.com/a_b?x=1) now.", "See the docs now.");
    speaks("![a cat](https://img.example/cat.png)", "a cat");
    speaks("[**bold** link](http://x.y)", "bold link");
  });
  it("keeps bracketed text that is not a link", () => {
    speaks("an [aside] here", "an aside here");
    speaks("open [bracket without close", "open [bracket without close");
  });
  it("drops bare and angle-bracket URLs", () => {
    speaks("Visit https://example.com/path_with_underscores today.", "Visit  today.");
    speaks("Go to <https://example.com> now", "Go to  now");
    speaks("HTTP://EXAMPLE.COM is shouting", "is shouting");
  });
  it("keeps words that start like a URL", () => {
    speaks("http is a protocol; https too.", "http is a protocol; https too.");
    speaks("the h", "the h");
  });
  it("collapses blank lines and trims leading whitespace", () => {
    speaks("\n\n  Hello\n\n\nWorld\n", "Hello\nWorld\n");
  });
  it("handles a fence that spans many deltas", () => {
    const f = new SpeechFilter();
    let out = f.push("Intro\n`");
    out += f.push("`");
    out += f.push("`js\nlet a");
    out += f.push(" = 1;\n`");
    out += f.push("``\nOutro");
    expect(out + f.end()).toBe("Intro\nOutro");
  });
  it("emits text promptly instead of waiting for the end of the line", () => {
    const f = new SpeechFilter();
    expect(f.push("Hello there, ")).toBe("Hello there, ");
    expect(f.push("how [are")).toBe("how ");
    expect(f.push(" you](https://x.y) doing")).toBe("are you doing");
  });
  it("caps spoken text at 1500 characters", () => {
    const long = "word ".repeat(1000);
    const f = new SpeechFilter();
    let out = "";
    for (let i = 0; i < long.length; i += 37) out += f.push(long.slice(i, i + 37));
    out += f.end();
    expect(MAX_SPOKEN_CHARS).toBe(1500);
    expect(out.length).toBe(1500);
    expect(f.push("more")).toBe("");
  });
  it("toSpeech converts a whole reply", () => {
    expect(toSpeech("**Hi** `there`_")).toBe("Hi there");
    expect(toSpeech("```\nonly code\n```")).toBe("");
  });
});
