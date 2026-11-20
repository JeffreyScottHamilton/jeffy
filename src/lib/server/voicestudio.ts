import "server-only";
import type { VoiceStudioConfig } from "./config";
import {
  VoiceAuthError,
  VoiceBusyError,
  VoiceConfigError,
  VoiceOfflineError,
  VoiceTimeoutError,
  VoiceUpstreamError,
} from "./errors";

type FetchImpl = typeof fetch;

function retryAfter(res: Response): number | undefined {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 300) : undefined;
}

function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function synthesize(
  text: string,
  cfg: VoiceStudioConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authToken) headers.Authorization = `Bearer ${cfg.authToken}`;
  const body: Record<string, string> = {
    input: text,
    voice: cfg.voiceId,
    response_format: cfg.responseFormat,
  };
  if (cfg.model) body.model = cfg.model;

  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    if (isTimeout(e)) throw new VoiceTimeoutError();
    // fetch network failures (TypeError, ECONNREFUSED, ENOTFOUND, ...)
    throw new VoiceOfflineError();
  }

  const s = res.status;
  if (!res.ok) {
    void res.body?.cancel().catch(() => {});
    const opts = { upstreamStatus: s, retryAfterSeconds: retryAfter(res) };
    if (s === 401 || s === 403) throw new VoiceAuthError(opts);
    if ([400, 404, 409, 422].includes(s)) throw new VoiceConfigError(opts);
    if (s === 503 || s === 429) throw new VoiceBusyError(opts);
    if (s === 502) throw new VoiceOfflineError(opts);
    if (s === 504) throw new VoiceTimeoutError(opts);
    throw new VoiceUpstreamError("Voice service returned an error", opts);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("audio/")) {
    void res.body?.cancel().catch(() => {});
    throw new VoiceUpstreamError("Voice service returned a non-audio response", { upstreamStatus: s });
  }
  let audio: ArrayBuffer;
  try {
    audio = await res.arrayBuffer();
  } catch (e) {
    if (isTimeout(e)) throw new VoiceTimeoutError();
    throw new VoiceUpstreamError("Voice service response was interrupted", { upstreamStatus: s });
  }
  if (audio.byteLength === 0) {
    throw new VoiceUpstreamError("Voice service returned empty audio", { upstreamStatus: s });
  }
  return { audio, contentType };
}

export async function checkHealth(
  cfg: VoiceStudioConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; status?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (cfg.authToken) headers.Authorization = `Bearer ${cfg.authToken}`;
    const res = await fetchImpl(`${cfg.baseUrl}/health`, {
      headers,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    const j = (await res.json().catch(() => ({}))) as { status?: unknown };
    return { ok: true, status: typeof j.status === "string" ? j.status : undefined };
  } catch {
    return { ok: false };
  }
}
