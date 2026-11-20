# VoiceStudio setup (optional, self-hosted)

The default voice is hosted [Gradium](gradium.md). Use VoiceStudio only if you prefer to keep voice data on your own computer; set `VOICE_PROVIDER=voicestudio`.

Jeffy uses [VoiceStudio](https://github.com/debpalash/VoiceStudio) (OpenAI-compatible `/v1/audio/speech`) for the voice. Supported release: **0.5.6**. Newer tags such as v0.5.9-beta.7 are betas. Pin an exact tag; never use `:latest`.

## 1. Install on loopback

Docker (host port bound to loopback only):

```bash
docker run -d --name voicestudio --restart unless-stopped \
  -p 127.0.0.1:3900:3900 \
  -v voicestudio-data:/app/omnivoice_data -e OMNIVOICE_DATA_DIR=/app/omnivoice_data \
  ghcr.io/debpalash/voicestudio:0.5.6
```

From source: `uvicorn backend.main:app --host 127.0.0.1 --port 3900`. A desktop app also exists. `OMNIVOICE_BIND_HOST` defaults to 127.0.0.1; leave it.

Health check (503 `{"status":"starting"}` while loading, then 200):

```bash
curl http://127.0.0.1:3900/health
```

## 2. Test with a built-in voice

```bash
curl -X POST http://127.0.0.1:3900/v1/audio/speech -H 'Content-Type: application/json' \
  -d '{"input":"Hello from Jeffy.","voice":"alloy","response_format":"wav"}' --output hello.wav
curl http://127.0.0.1:3900/v1/audio/voices      # list voices and profiles
```

`alloy` (also ash, ballad, cedar, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse, default) maps to the active engine's default voice. WAV needs no ffmpeg; mp3 and other formats do.

The first request may download models and take minutes (generation timeout 300 s). Warm up with the command above before relying on hosted use.

## 3. Clone your own voice

Only clone your own voice. Record 10 to 30 s of clean speech, one speaker, quiet room, and write down the exact transcript.

- UI: open VoiceStudio at http://127.0.0.1:3900 and create a voice profile from the recording.
- API:

```bash
curl -X POST http://127.0.0.1:3900/profiles \
  -F name="my-voice" -F ref_audio=@recording.wav \
  -F ref_text="Exact transcript of the recording." -F language=Auto -F kind=clone
```

The JSON response has an 8-character `id`. Set `VOICESTUDIO_VOICE_ID` to it (a unique profile name also works; an ambiguous name returns 409). Test with `"voice":"<id>"` in the curl above.

Reference audio is stored on the VoiceStudio machine at `<DATA_DIR>/voices/<id>.<ext>`: `~/.omnivoice` (Linux), `~/Library/Application Support/OmniVoice` (macOS), `%APPDATA%\OmniVoice` (Windows), or `OMNIVOICE_DATA_DIR` / the Docker volume. It stays there. Never upload it to Vercel or git.

## 4. Authenticated HTTPS gateway (hosted use)

VoiceStudio does not gate loopback requests, and its optional `OMNIVOICE_API_KEY` is an admin credential. So do not expose it directly. A same-host Caddy proxy is the auth boundary:

```
VoiceStudio 127.0.0.1:3900 -> Caddy 127.0.0.1:8787 (bearer token, allowlist) -> Tailscale Funnel -> https://<machine>.<tailnet>.ts.net
```

Caddy allows only `POST /v1/audio/speech` and `GET /health`, caps bodies at 64 KB, answers 401 without the token and 404 for any other route, and strips `Authorization` and forwarding headers before proxying. Config: [../deploy/gateway/Caddyfile](../deploy/gateway/Caddyfile).

1. Install Caddy (https://caddyserver.com/docs/install) and Tailscale.
2. Generate a token and keep it in a password manager:
   ```bash
   export VOICESTUDIO_AUTH_TOKEN="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48)"
   ```
3. Run Caddy (refuses to start with a missing or short token):
   ```bash
   if [ "${#VOICESTUDIO_AUTH_TOKEN}" -ge 32 ]; then
     caddy run --config deploy/gateway/Caddyfile --adapter caddyfile
   else
     echo "VOICESTUDIO_AUTH_TOKEN is missing or shorter than 32 characters; not starting Caddy."
   fi
   ```
4. Publish with Tailscale Funnel: `tailscale funnel --bg 8787`. Funnel serves public HTTPS on 443 (also 8443, 10000) and must be enabled for your tailnet (ACL `nodeAttrs` with the `funnel` attribute). `tailscale funnel status` shows the URL. That URL is `VOICESTUDIO_BASE_URL`. (Alternative: a Cloudflare Tunnel pointed at the same port 8787.)
5. Verify:
   ```bash
   VOICESTUDIO_AUTH_TOKEN=... VOICESTUDIO_VOICE_ID=<id> deploy/gateway/verify-gateway.sh https://<machine>.<tailnet>.ts.net
   ```
   It checks: no auth 401, wrong token 401, valid token `/health` 200, `/profiles` 404, speech returns `audio/*`.
6. From outside, unauthenticated requests must get 401: `curl -i https://<machine>.<tailnet>.ts.net/health`. From another device on your LAN, port 3900 must not answer: `curl --max-time 3 http://<lan-ip>:3900/health` should fail.

Set `VOICESTUDIO_BASE_URL` and `VOICESTUDIO_AUTH_TOKEN` on Vercel ([deploy-vercel.md](deploy-vercel.md)). To rotate the token, change it here and on Vercel, restart Caddy, redeploy.

## 5. Run as services

Docker's `--restart unless-stopped` covers VoiceStudio. Run Caddy as a service (`caddy` package service, a systemd unit, or launchd) with `VOICESTUDIO_AUTH_TOKEN` in its environment file (mode 600), and `tailscale funnel --bg 8787` persists across restarts. Reboot once and re-run `verify-gateway.sh`.

## Home computer caveat

Hosted audio works only while that computer is awake, online, and running VoiceStudio, Caddy and Tailscale. Otherwise Jeffy shows "voice service is offline". Disable sleep on AC power (macOS: System Settings, Battery or Energy, prevent automatic sleeping; Windows: Power and sleep, Sleep: Never; Linux: `systemctl mask sleep.target` or your desktop's power setting). Keep the machine's disk and models warm: restart VoiceStudio, then warm up.
