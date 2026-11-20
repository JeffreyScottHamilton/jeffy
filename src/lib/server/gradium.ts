import "server-only";
import { GradiumClient } from "@gradium/sdk";
import type { GradiumConfig } from "./config";
import {
  VoiceAuthError,
  VoiceBusyError,
  VoiceConfigError,
  VoiceOfflineError,
  VoiceQuotaError,
  VoiceTimeoutError,
  VoiceUpstreamError,
} from "./errors";

/** The slice of GradiumClient used here; tests inject a fake. */
export type GradiumLike = {
  tts(
    setup: { voice_id: string; output_format: string },
    text: string,
    options?: { timeoutMs?: number },
  ): Promise<{ rawData: Uint8Array }>;
};
export type GradiumClientFactory = (apiKey: string) => GradiumLike;

const defaultFactory: GradiumClientFactory = (apiKey) => new GradiumClient({ apiKey });

class Deadline extends Error {}

function isTimeout(e: unknown): boolean {
  if (e instanceof Deadline) return true;
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

// Only numeric facts are read from errors; messages/bodies may echo input and are never logged or forwarded.
function statusOf(e: unknown): number | undefined {
  const x = e as { status?: unknown; code?: unknown; message?: unknown };
  for (const v of [x?.status, x?.code]) {
    if (typeof v === "number" && v >= 400 && v < 600) return v;
  }
  // ws handshake failures read "Unexpected server response: 401".
  if (typeof x?.message === "string") {
    const m = /server response: (\d{3})/i.exec(x.message);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function mapError(e: unknown): Error {
  if (isTimeout(e)) return new VoiceTimeoutError();
  const s = statusOf(e);
  const opts = { upstreamStatus: s };
  const msg = typeof (e as { message?: unknown })?.message === "string" ? (e as { message: string }).message : "";
  if (s === 401 || s === 403) return new VoiceAuthError(opts);
  if (s === 402 || /credit|quota|insufficient/i.test(msg)) return new VoiceQuotaError(opts);
  if (s === 429) return new VoiceBusyError(opts);
  if (s === 404 || s === 400 || s === 422 || /voice.*not found|unknown voice/i.test(msg)) {
    return new VoiceConfigError(opts);
  }
  if (s === 502 || s === 503) return new VoiceOfflineError(opts);
  if (s === 504) return new VoiceTimeoutError(opts);
  if (s !== undefined) return new VoiceUpstreamError("Voice service returned an error", opts);
  const name = (e as { name?: string })?.name;
  if (name === "GradiumWebSocketError" || name === "TypeError") return new VoiceOfflineError();
  return new VoiceUpstreamError("Voice service failed");
}

export async function synthesizeGradium(
  text: string,
  cfg: GradiumConfig,
  clientFactory: GradiumClientFactory = defaultFactory,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bytes: Uint8Array;
  try {
    const client = clientFactory(cfg.apiKey);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Deadline()), cfg.timeoutMs);
    });
    const result = await Promise.race([
      client.tts({ voice_id: cfg.voiceId, output_format: "wav" }, text, { timeoutMs: cfg.timeoutMs }),
      deadline,
    ]);
    bytes = result.rawData;
  } catch (e) {
    throw mapError(e);
  } finally {
    clearTimeout(timer);
  }
  if (!bytes || bytes.byteLength === 0) {
    throw new VoiceUpstreamError("Voice service returned empty audio");
  }
  const audio = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audio).set(bytes);
  return { audio, contentType: "audio/wav" };
}
