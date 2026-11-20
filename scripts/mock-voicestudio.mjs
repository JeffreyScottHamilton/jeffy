// DEV MOCK of VoiceStudio. NOT the real voice. Returns a short chime, not speech.
// Usage: npm run mock:voicestudio   (PORT=3900 by default, bound to 127.0.0.1)
// MOCK_MODE=offline|slow|busy|badvoice simulates failures.
import http from "node:http";

const PORT = Number(process.env.PORT || 3900);
const MODE = process.env.MOCK_MODE || "";
const RATE = 24000;

function chime(input) {
  const seconds = Math.min(3, Math.max(0.5, 0.5 + input.length * 0.04));
  const n = Math.floor(RATE * seconds);
  const data = Buffer.alloc(n * 2);
  const half = n / 2;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const first = i < half;
    const f = first ? 523.25 : 659.25;
    const local = first ? i : i - half;
    const len = half;
    const env = Math.min(1, local / (RATE * 0.03)) * Math.exp((-3 * local) / len);
    const s = Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2 * t) * 0.15;
    data.writeInt16LE(Math.round(s * env * 0.25 * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function send(res, status, body, type = "application/json", extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  res.on("finish", () => console.log(`[mock] ${req.method} ${path} ${res.statusCode}`));

  if (MODE === "offline") return req.destroy();

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, JSON.stringify({ status: "ok", engine: "mock" }));
  }

  if (req.method === "POST" && path === "/v1/audio/speech") {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 65536) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(res, 422, JSON.stringify({ error: "invalid_json" }));
      }
      const input = body && body.input;
      const voice = body && body.voice;
      if (typeof input !== "string" || !input.trim() || input.length > 4096) {
        return send(res, 422, JSON.stringify({ error: "invalid_input" }));
      }
      if (typeof voice !== "string" || !voice.trim()) {
        return send(res, 422, JSON.stringify({ error: "invalid_voice" }));
      }
      if (MODE === "badvoice") {
        return send(res, 404, JSON.stringify({ error: "voice_not_found" }));
      }
      if (MODE === "busy") {
        return send(res, 503, JSON.stringify({ error: "busy" }), "application/json", { "Retry-After": "5" });
      }
      const respond = () => send(res, 200, chime(input), "audio/wav");
      if (MODE === "slow") setTimeout(respond, 60000);
      else respond();
    });
    return;
  }

  send(res, 404, JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] DEV MOCK of VoiceStudio (not the real voice) on http://127.0.0.1:${PORT}${MODE ? ` mode=${MODE}` : ""}`);
});
