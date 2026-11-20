import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Turn } from "./prompt";

type Item = { topic: string; keywords: string[]; text: string };
type Example = { question: string; answer: string; keywords?: string[] };
export type Profile = {
  name: string;
  summary: string;
  style: string;
  phrases: string[];
  facts: Item[];
  preferences: Item[];
  examples: Example[];
};
export type ProfileExcerpt = {
  name: string;
  style: string;
  phrases: string[];
  items: { kind: "fact" | "preference"; topic: string; text: string }[];
  examples: { question: string; answer: string }[];
};

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function arr<T>(raw: Record<string, unknown>, key: string, check: (v: unknown) => v is T): T[] {
  const v = raw[key];
  if (!Array.isArray(v)) throw new ProfileError(`Profile field "${key}" must be an array`);
  v.forEach((entry, i) => {
    if (!check(entry)) throw new ProfileError(`Profile field "${key}" has an invalid entry at index ${i}`);
  });
  return v as T[];
}
const isItem = (v: unknown): v is Item =>
  isObj(v) && isStr(v.topic) && isStrArr(v.keywords) && isStr(v.text);
const isExample = (v: unknown): v is Example =>
  isObj(v) &&
  isStr(v.question) &&
  isStr(v.answer) &&
  (v.keywords === undefined || isStrArr(v.keywords));

export function parseProfile(raw: unknown): Profile {
  if (!isObj(raw)) throw new ProfileError("Profile must be a JSON object");
  for (const k of ["name", "summary", "style"]) {
    if (!isStr(raw[k])) throw new ProfileError(`Profile field "${k}" must be a string`);
  }
  if (!isStrArr(raw.phrases)) throw new ProfileError(`Profile field "phrases" must be an array of strings`);
  return {
    name: raw.name as string,
    summary: raw.summary as string,
    style: raw.style as string,
    phrases: raw.phrases,
    facts: arr(raw, "facts", isItem),
    preferences: arr(raw, "preferences", isItem),
    examples: arr(raw, "examples", isExample),
  };
}

type Source = "env" | "file" | "example";
const cache = new Map<string, Profile>();

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "profile", file), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw new ProfileError(`Profile file ${file} could not be read as JSON`);
  }
}

export async function loadProfile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ profile: Profile; source: Source }> {
  const get = (source: Source, make: () => Promise<Profile | undefined>) =>
    (async () => {
      const hit = cache.get(source === "env" ? `env:${env.JEFFY_PROFILE_JSON}` : source);
      if (hit) return hit;
      const p = await make();
      if (p) cache.set(source === "env" ? `env:${env.JEFFY_PROFILE_JSON}` : source, p);
      return p;
    })();

  if (env.VERCEL_ENV !== "preview") {
    const json = env.JEFFY_PROFILE_JSON?.trim();
    if (json) {
      const profile = await get("env", async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          throw new ProfileError("JEFFY_PROFILE_JSON is not valid JSON");
        }
        return parseProfile(parsed);
      });
      return { profile: profile!, source: "env" };
    }
    const file = await get("file", async () => {
      const raw = await readJson("profile.private.json");
      return raw === undefined ? undefined : parseProfile(raw);
    });
    if (file) return { profile: file, source: "file" };
  }
  const example = await get("example", async () => {
    const raw = await readJson("example.profile.json");
    if (raw === undefined) throw new ProfileError("Example profile is missing");
    return parseProfile(raw);
  });
  return { profile: example!, source: "example" };
}

const STOPWORDS = new Set(
  ("a an and are as at be but by do does did for from had has have how i if in is it its me my of on or so " +
    "that the their them then there these they this to us was we were what when where which who why will with " +
    "would you your about can could should tell please like just any some").split(" "),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

export function selectRelevant(profile: Profile, question: string, history: Turn[]): ProfileExcerpt {
  const q = new Set(tokens(question));
  const lastQ = history.length ? new Set(tokens(history[history.length - 1].question)) : new Set<string>();
  const score = (parts: string[]) => {
    const bag = new Set(tokens(parts.join(" ")));
    let s = 0;
    for (const t of q) if (bag.has(t)) s += 2;
    for (const t of lastQ) if (bag.has(t)) s += 1;
    return s;
  };

  const items = [
    ...profile.facts.map((i) => ({ kind: "fact" as const, i })),
    ...profile.preferences.map((i) => ({ kind: "preference" as const, i })),
  ]
    .map(({ kind, i }) => ({
      kind,
      topic: i.topic,
      text: i.text,
      score: score([...i.keywords, i.topic, i.text]),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ kind, topic, text }) => ({ kind, topic, text }));

  const examples = profile.examples
    .map((e) => ({
      question: e.question,
      answer: e.answer,
      score: score([...(e.keywords ?? []), e.question]),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ question, answer }) => ({ question, answer }));

  return {
    name: profile.name,
    style: profile.style,
    phrases: profile.phrases.slice(0, 4),
    items,
    examples,
  };
}
