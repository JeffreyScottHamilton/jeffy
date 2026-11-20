# Jeffy

Jeffy takes typed questions and answers out loud in the owner's cloned voice. Replies are short, are never shown as text, and are labeled as AI-generated audio. There is no in-app sign-in: keep a private deployment behind Vercel Deployment Protection (see [docs/deploy-vercel.md](docs/deploy-vercel.md)).

## Architecture

```
Browser --POST /api/chat--> Jeffy (Next.js on Vercel)
                              |-- selects profile excerpts, asks Gemini (gemini-3.5-flash-lite) for a short reply
                              '-- sends reply text to Gradium (default, hosted TTS over WebSocket)
                                    or, optionally, to self-hosted VoiceStudio  POST /v1/audio/speech
Browser <------ audio bytes ----'
```

## Quick start (local)

Default voice provider: [Gradium](docs/gradium.md) (hosted; no computer needs to stay on).

1. Get a free key at [gradium.ai](https://gradium.ai) and a Gemini key from Google AI Studio.
2. Clone your voice: `GRADIUM_API_KEY=... npm run clone:gradium -- recording.wav "My voice"` (or use the Gradium web app). It prints a voice uid.
3. Set three variables in `.env.local`: `GOOGLE_GENERATIVE_AI_API_KEY`, `GRADIUM_API_KEY`, `GRADIUM_VOICE_ID`.

```bash
npm install
cp .env.example .env.local        # fill in the three variables above
npm run dev
```

To try a built-in voice first: `GRADIUM_API_KEY=... npm run voices:gradium`, then use one of the uids.

Optional, self-hosted: VoiceStudio on your own computer. Set `VOICE_PROVIDER=voicestudio` and see [docs/voicestudio.md](docs/voicestudio.md) (or `npm run mock:voicestudio` for a fake chime).

Open http://localhost:3000.

## Profile

Jeffy answers personal questions only from a profile you write. Without one it uses the fictional `profile/example.profile.json`.

```bash
cp profile/example.profile.json profile/profile.private.json   # gitignored; edit it
```

On Vercel set `JEFFY_PROFILE_JSON` instead (one-line JSON). Preview deployments always use the example.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run clone:gradium -- file.wav "Name" [lang]` | Create a Gradium voice from a recording; prints the uid |
| `npm run voices:gradium` | List Gradium voices (uid and name) |
| `npm run mock:voicestudio` | Fake VoiceStudio on 127.0.0.1:3900. `MOCK_MODE=offline\|slow\|busy\|badvoice` simulates failures; `PORT` changes the port |

## Environment variables

All are server-only. Set them in `.env.local` locally and in Vercel Project Settings for hosting.

| Name | Required | Local value | Vercel value | Scope |
| --- | --- | --- | --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | your Gemini key | same (Sensitive) | Production, Preview |
| `VOICE_PROVIDER` | no | `gradium` if `GRADIUM_API_KEY` is set, else `voicestudio` | `gradium` | any |
| `GRADIUM_API_KEY` | with Gradium | your Gradium key | same (Sensitive) | Production, Preview |
| `GRADIUM_VOICE_ID` | with Gradium | cloned voice uid | Production: clone uid; Preview: a built-in voice uid | per environment |
| `VOICE_TIMEOUT_MS` | no | 40000 | 40000 | any; falls back to `VOICESTUDIO_TIMEOUT_MS` |
| `VOICESTUDIO_BASE_URL` | VoiceStudio only | `http://127.0.0.1:3900` | gateway URL, `https://<machine>.<tailnet>.ts.net` | Production (Preview optional) |
| `VOICESTUDIO_VOICE_ID` | VoiceStudio only | `alloy` (built-in) | Production: cloned profile id; Preview: `alloy` | per environment |
| `VOICESTUDIO_AUTH_TOKEN` | VoiceStudio: required when base URL is not loopback | empty | gateway token (Sensitive) | Production, Preview if it uses the gateway |
| `JEFFY_PROFILE_JSON` | no | unset (use `profile/profile.private.json`) | minified profile JSON | Production only; never Preview |
| `JEFFY_PASSWORD` | no | unset (no gate) | a strong random password (Sensitive) | Production only; unset = open. Changing it signs everyone out |
| `JEFFY_TIMEZONE` | no | `America/Denver` | your IANA timezone | any; used to resolve "yesterday" / "today" |
| `VOICESTUDIO_MODEL` | no | unset | unset | sent as `model` only if set |
| `VOICESTUDIO_RESPONSE_FORMAT` | no | `wav` | `wav` or `mp3` (mp3 needs ffmpeg on the VoiceStudio machine) | any |
| `VOICESTUDIO_TIMEOUT_MS` | no | 40000 | legacy name of `VOICE_TIMEOUT_MS` | any |
| `GEMINI_TIMEOUT_MS` | no | 15000 | 15000 | any |

`VOICESTUDIO_BASE_URL` must be `https:` unless it is loopback.

## Troubleshooting

| Code / message | Cause and fix |
| --- | --- |
| `invalid_request` "Type a question first." / "Keep questions under 500 characters." | Empty or too-long question. Shorten it. |
| `config_missing` "Jeffy isn't fully set up yet. Missing: ..." | Add the named variables (`.env.local` or Vercel), then restart or redeploy. A config line mentioning https means `VOICESTUDIO_BASE_URL` is plain http on a non-loopback host. A missing `VOICESTUDIO_AUTH_TOKEN` is reported the same way. |
| `config_missing` "The Gemini key was rejected." | Check `GOOGLE_GENERATIVE_AI_API_KEY`; create a new key in Google AI Studio. |
| `rate_limited` | Gemini quota hit. Wait a moment or use a key with a higher tier. |
| `model_error` "couldn't think of an answer" | Gemini failed or timed out. Retry; raise `GEMINI_TIMEOUT_MS` if it repeats. |
| `voice_offline` | Gradium unreachable (retry), or VoiceStudio, Caddy or Tailscale is not running, or the computer is asleep. Run `curl http://127.0.0.1:3900/health` on that machine, then [docs/voicestudio.md](docs/voicestudio.md). |
| `voice_timeout` | Voice generation exceeded `VOICE_TIMEOUT_MS` (first request may be downloading models; warm it up). Vercel functions stop at 60 s. |
| `voice_busy` | Gradium rate limit (429) or VoiceStudio at capacity. Retry shortly. |
| `voice_quota` "free voice allowance is used up" | Gradium credits are exhausted. Wait for the monthly reset or upgrade; see [docs/gradium.md](docs/gradium.md). Not retryable. |
| `voice_auth` "rejected Jeffy's credentials" | `GRADIUM_API_KEY` is wrong or revoked; or, for VoiceStudio, `VOICESTUDIO_AUTH_TOKEN` differs from the gateway's token. Re-run `deploy/gateway/verify-gateway.sh`. |
| `voice_config` "isn't set up correctly" | `GRADIUM_VOICE_ID` is unknown (list with `npm run voices:gradium`); or `VOICESTUDIO_VOICE_ID` is unknown or matches several profiles. List voices (`GET /v1/audio/voices`) and use the 8-char id. |
| `internal` | Unexpected error. Check server logs for `[jeffy] chat failed` (error codes only). |
| Reply plays nothing, browser blocked autoplay | Press play; autoplay is best effort. |

## Docs

- [docs/gradium.md](docs/gradium.md): default hosted voice: signup, cloning, quota
- [docs/voicestudio.md](docs/voicestudio.md): optional self-hosted voice: install VoiceStudio, clone your voice, authenticated HTTPS gateway
- [docs/deploy-vercel.md](docs/deploy-vercel.md): deploy and keep production private
- [docs/privacy.md](docs/privacy.md): what data goes where
