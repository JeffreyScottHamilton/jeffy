/**
 * Plays streamed PCM (s16le mono) through one shared AudioContext, scheduling chunks back-to-back.
 * One voice at a time: starting a new session stops the previous one. Not React; Chat owns an instance.
 */

/** Seconds of lead before the first chunk (and after an underrun) so scheduling never lands in the past. */
const LEAD_S = 0.1;

export type PlaybackResult = {
  /** True when the whole reply was received (audio_end) before playback stopped. */
  complete: boolean;
  /** WAV of the collected PCM; only when complete. */
  wav: Blob | null;
};

export function pcmToWav(chunks: Uint8Array[], sampleRate: number): Blob {
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + len, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, len, true);
  return new Blob([header, ...(chunks as BlobPart[])], { type: "audio/wav" });
}

type Session = {
  turnId: string;
  onDone: (r: PlaybackResult) => void;
  ended: boolean;
  sampleRate: number;
  chunks: Uint8Array[];
  sources: Set<AudioBufferSourceNode>;
  nextTime: number;
  startTime: number;
  scheduled: number;
  carry: Uint8Array | null;
};

export class VoiceEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private out: GainNode | null = null;
  private session: Session | null = null;
  private listeners = new Set<() => void>();
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  paused = false;

  /** Create and resume the context. Call from inside a user gesture. */
  unlock(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      this.out.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.levelBuf = new Uint8Array(this.analyser.fftSize);
    }
    this.paused = false;
    void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  get context() {
    return this.ctx;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** True from begin() until the session finishes or is stopped. */
  get active() {
    return this.session !== null;
  }
  get turnId() {
    return this.session?.turnId ?? null;
  }

  begin(turnId: string, onDone: (r: PlaybackResult) => void, sampleRate = 24000) {
    this.stop();
    this.unlock();
    this.session = {
      turnId,
      onDone,
      ended: false,
      sampleRate,
      chunks: [],
      sources: new Set(),
      nextTime: 0,
      startTime: -1,
      scheduled: 0,
      carry: null,
    };
    this.emit();
  }

  /** Queue a raw PCM chunk (any byte length; odd trailing bytes carry into the next chunk). */
  push(bytes: Uint8Array, sampleRate: number) {
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx || !this.out || s.ended) return;
    s.sampleRate = sampleRate;
    s.chunks.push(bytes);
    let data = bytes;
    if (s.carry) {
      const joined = new Uint8Array(s.carry.byteLength + bytes.byteLength);
      joined.set(s.carry);
      joined.set(bytes, s.carry.byteLength);
      data = joined;
      s.carry = null;
    }
    const usable = data.byteLength - (data.byteLength % 2);
    if (usable < data.byteLength) s.carry = data.slice(usable);
    if (usable === 0) return;
    const view = new DataView(data.buffer, data.byteOffset, usable);
    const n = usable / 2;
    const buf = ctx.createBuffer(1, n, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    this.schedule(s, buf);
  }

  private schedule(s: Session, buf: AudioBuffer) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.out!);
    const now = ctx.currentTime;
    // First chunk or an underrun: re-buffer with a small lead instead of starting in the past.
    const at = s.nextTime > now ? s.nextTime : now + LEAD_S;
    if (s.startTime < 0) s.startTime = at;
    else if (at !== s.nextTime) s.startTime += at - s.nextTime; // keep position() honest across a gap
    src.start(at);
    s.nextTime = at + buf.duration;
    s.scheduled += buf.duration;
    s.sources.add(src);
    src.onended = () => {
      s.sources.delete(src);
      this.maybeFinish(s);
    };
  }

  /** Play one encoded file (wav/mp3) as the whole session. */
  async playEncoded(turnId: string, data: ArrayBuffer, onDone: (r: PlaybackResult) => void) {
    this.begin(turnId, onDone);
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx) return;
    try {
      const buf = await ctx.decodeAudioData(data);
      if (this.session !== s) return;
      this.schedule(s, buf);
    } catch {
      /* undecodable: finish silently */
    }
    if (this.session === s) this.end();
  }

  /** No more chunks are coming; the session finishes when the last one has played. */
  end() {
    const s = this.session;
    if (!s) return;
    s.ended = true;
    this.maybeFinish(s);
  }

  private maybeFinish(s: Session) {
    if (this.session === s && s.ended && s.sources.size === 0) this.finish(s);
  }

  private finish(s: Session) {
    this.session = null;
    const complete = s.ended;
    const wav = complete && s.chunks.length ? pcmToWav(s.chunks, s.sampleRate) : null;
    this.emit();
    s.onDone({ complete, wav });
  }

  /** Halt playback now. Whatever was received so far is dropped. */
  stop() {
    const s = this.session;
    if (!s) return;
    s.sources.forEach((src) => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    s.sources.clear();
    this.finish(s);
  }

  pause() {
    this.paused = true;
    void this.ctx?.suspend().catch(() => {});
    this.emit();
  }
  resume() {
    this.paused = false;
    void this.ctx?.resume().catch(() => {});
    this.emit();
  }

  /** Seconds played of the current session. */
  position(): number {
    const s = this.session;
    if (!s || !this.ctx || s.startTime < 0) return 0;
    return Math.min(s.scheduled, Math.max(0, this.ctx.currentTime - s.startTime));
  }
  /** Seconds received so far. */
  duration(): number {
    return this.session?.scheduled ?? 0;
  }
  get receivedAll() {
    return this.session?.ended ?? false;
  }

  /** Output loudness 0..1 (RMS of what is being played). */
  level(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const x = (this.levelBuf[i] - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 3);
  }

  dispose() {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
    this.out = null;
    this.listeners.clear();
  }
}
