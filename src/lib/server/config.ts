import "server-only";

export type VoiceStudioConfig = {
  baseUrl: string;
  voiceId: string;
  authToken?: string;
  model?: string;
  responseFormat: "wav" | "mp3";
  timeoutMs: number;
};
export type JeffyConfig = {
  geminiApiKey: string;
  voicestudio: VoiceStudioConfig;
  geminiTimeoutMs: number;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: JeffyConfig } | { ok: false; missing: string[]; problems: string[] } {
  const get = (k: string) => env[k]?.trim() || undefined;
  const missing: string[] = [];
  const problems: string[] = [];

  const geminiApiKey = get("GOOGLE_GENERATIVE_AI_API_KEY");
  const rawBase = get("VOICESTUDIO_BASE_URL");
  const voiceId = get("VOICESTUDIO_VOICE_ID");
  const authToken = get("VOICESTUDIO_AUTH_TOKEN");
  if (!geminiApiKey) missing.push("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!rawBase) missing.push("VOICESTUDIO_BASE_URL");
  if (!voiceId) missing.push("VOICESTUDIO_VOICE_ID");

  let baseUrl = "";
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

  const fmt = get("VOICESTUDIO_RESPONSE_FORMAT")?.toLowerCase();
  if (fmt && fmt !== "wav" && fmt !== "mp3") {
    problems.push("VOICESTUDIO_RESPONSE_FORMAT must be wav or mp3");
  }

  if (missing.length || problems.length) return { ok: false, missing, problems };

  return {
    ok: true,
    config: {
      geminiApiKey: geminiApiKey!,
      geminiTimeoutMs: num(get("GEMINI_TIMEOUT_MS"), 15000),
      voicestudio: {
        baseUrl,
        voiceId: voiceId!,
        authToken,
        model: get("VOICESTUDIO_MODEL"),
        responseFormat: fmt === "mp3" ? "mp3" : "wav",
        timeoutMs: num(get("VOICESTUDIO_TIMEOUT_MS"), 40000),
      },
    },
  };
}
