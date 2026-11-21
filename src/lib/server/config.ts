import "server-only";

export type VoiceStudioConfig = {
  baseUrl: string;
  voiceId: string;
  authToken?: string;
  model?: string;
  responseFormat: "wav" | "mp3";
  timeoutMs: number;
};
export type GradiumConfig = { apiKey: string; voiceId: string; timeoutMs: number };
export type VoiceProvider = "gradium" | "voicestudio";
export type VoiceConfig = {
  provider: VoiceProvider;
  voicestudio: VoiceStudioConfig;
  gradium: GradiumConfig;
};
/** Voice settings are checked separately: they only matter when a request asks for voice. */
export type VoiceConfigResult = { ok: true; config: VoiceConfig } | { ok: false; missing: string[]; problems: string[] };
export type JeffyConfig = {
  geminiApiKey: string;
  geminiTimeoutMs: number;
  voice: VoiceConfigResult;
};

export const DEFAULT_GEMINI_TIMEOUT_MS = 50000;

const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Text chat needs only GOOGLE_GENERATIVE_AI_API_KEY; voice problems are reported in `config.voice`. */
export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: JeffyConfig } | { ok: false; missing: string[]; problems: string[] } {
  const geminiApiKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!geminiApiKey) return { ok: false, missing: ["GOOGLE_GENERATIVE_AI_API_KEY"], problems: [] };
  return {
    ok: true,
    config: {
      geminiApiKey,
      geminiTimeoutMs: num(env.GEMINI_TIMEOUT_MS?.trim(), DEFAULT_GEMINI_TIMEOUT_MS),
      voice: readVoiceConfig(env),
    },
  };
}

export function readVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfigResult {
  const get = (k: string) => env[k]?.trim() || undefined;
  const missing: string[] = [];
  const problems: string[] = [];
  const rawProvider = get("VOICE_PROVIDER")?.toLowerCase();
  let provider: VoiceProvider = get("GRADIUM_API_KEY") ? "gradium" : "voicestudio";
  if (rawProvider === "gradium" || rawProvider === "voicestudio") provider = rawProvider;
  else if (rawProvider) problems.push("VOICE_PROVIDER must be gradium or voicestudio");

  const timeoutMs = num(get("VOICE_TIMEOUT_MS") ?? get("VOICESTUDIO_TIMEOUT_MS"), 40000);
  const gradiumApiKey = get("GRADIUM_API_KEY");
  const gradiumVoiceId = get("GRADIUM_VOICE_ID");
  const rawBase = get("VOICESTUDIO_BASE_URL");
  const voiceId = get("VOICESTUDIO_VOICE_ID");
  const authToken = get("VOICESTUDIO_AUTH_TOKEN");
  let baseUrl = "";
  let fmt: string | undefined;

  if (provider === "gradium") {
    if (!gradiumApiKey) missing.push("GRADIUM_API_KEY");
    if (!gradiumVoiceId) missing.push("GRADIUM_VOICE_ID");
  } else {
    if (!rawBase) missing.push("VOICESTUDIO_BASE_URL");
    if (!voiceId) missing.push("VOICESTUDIO_VOICE_ID");
    if (rawBase) {
      try {
        const u = new URL(rawBase);
        const loopback = LOOPBACK.has(u.hostname);
        if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) {
          problems.push("VOICESTUDIO_BASE_URL must use https unless it is a loopback address");
        } else if (u.username || u.password) {
          problems.push("VOICESTUDIO_BASE_URL must not contain credentials");
        } else {
          if (!loopback && !authToken) {
            problems.push("VOICESTUDIO_AUTH_TOKEN is required when VOICESTUDIO_BASE_URL is not a loopback address");
          }
          baseUrl = rawBase.replace(/\/+$/, "");
        }
      } catch {
        problems.push("VOICESTUDIO_BASE_URL is not a valid URL");
      }
    }
    fmt = get("VOICESTUDIO_RESPONSE_FORMAT")?.toLowerCase();
    if (fmt && fmt !== "wav" && fmt !== "mp3") {
      problems.push("VOICESTUDIO_RESPONSE_FORMAT must be wav or mp3");
    }
  }

  if (missing.length || problems.length) return { ok: false, missing, problems };

  return {
    ok: true,
    config: {
      provider,
      voicestudio: {
        baseUrl,
        voiceId: voiceId ?? "",
        authToken,
        model: get("VOICESTUDIO_MODEL"),
        responseFormat: fmt === "mp3" ? "mp3" : "wav",
        timeoutMs,
      },
      gradium: { apiKey: gradiumApiKey ?? "", voiceId: gradiumVoiceId ?? "", timeoutMs },
    },
  };
}
