import "server-only";
import type { ErrorCode } from "@/lib/api-types";

export class JeffyError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  retryAfterSeconds?: number;
  upstreamStatus?: number;
  constructor(
    code: ErrorCode,
    status: number,
    retryable: boolean,
    message: string,
    opts: { retryAfterSeconds?: number; upstreamStatus?: number } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.upstreamStatus = opts.upstreamStatus;
  }
}

type Opts = { retryAfterSeconds?: number; upstreamStatus?: number };

export class RateLimitError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("rate_limited", 429, true, "Model rate limited", opts);
  }
}
export class ModelAuthError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("config_missing", 503, false, "Model credentials rejected", opts);
  }
}
export class ModelTimeoutError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("model_error", 504, true, "Model timed out", opts);
  }
}
export class ModelError extends JeffyError {
  constructor(message = "Model failed", opts: Opts = {}) {
    super("model_error", 502, true, message, opts);
  }
}
export class VoiceOfflineError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_offline", 503, true, "Voice service offline", opts);
  }
}
export class VoiceTimeoutError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_timeout", 504, true, "Voice service timed out", opts);
  }
}
export class VoiceBusyError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_busy", 503, true, "Voice service busy", opts);
  }
}
export class VoiceAuthError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_auth", 502, false, "Voice service rejected credentials", opts);
  }
}
export class VoiceConfigError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_config", 502, false, "Voice configuration rejected", opts);
  }
}
export class VoiceUpstreamError extends JeffyError {
  constructor(message = "Voice service failed", opts: Opts = {}) {
    super("internal", 502, true, message, opts);
  }
}
export class VoiceQuotaError extends JeffyError {
  constructor(opts: Opts = {}) {
    super("voice_quota", 503, false, "Voice allowance used up", opts);
  }
}
