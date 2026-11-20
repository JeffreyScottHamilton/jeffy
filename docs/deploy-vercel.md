# Deploy to Vercel

Prerequisite for hosted audio: the authenticated gateway from [voicestudio.md](voicestudio.md) is running and `verify-gateway.sh` passes.

## 1. Import

Vercel dashboard, Add New, Project, import this repo. Framework preset Next.js, default build settings. The chat route sets `maxDuration = 60` (seconds); Vercel's response limit is 4.5 MB. WAV is about 48 KB/s, fine for short replies. If VoiceStudio has ffmpeg, set `VOICESTUDIO_RESPONSE_FORMAT=mp3` for smaller responses.

## 2. Environment variables

Project Settings, Environment Variables. Mark secrets as Sensitive.

Production:

| Name | Value |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | your Gemini key (Sensitive) |
| `VOICESTUDIO_BASE_URL` | `https://<machine>.<tailnet>.ts.net` |
| `VOICESTUDIO_AUTH_TOKEN` | the gateway token (Sensitive) |
| `VOICESTUDIO_VOICE_ID` | your cloned profile id |
| `JEFFY_PROFILE_JSON` | minified profile JSON (below) |

Preview:

| Name | Value |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key (Sensitive) |
| `VOICESTUDIO_BASE_URL`, `VOICESTUDIO_AUTH_TOKEN` | same as Production, or a mock-free public-demo gateway |
| `VOICESTUDIO_VOICE_ID` | `alloy` (built-in, not your clone) |
| `JEFFY_PROFILE_JSON` | do not set. The app also forces the fictional example when `VERCEL_ENV=preview` |

Minify the profile (keep it small; Vercel env vars total 64 KB):

```bash
node -e 'process.stdout.write(JSON.stringify(require("./profile/profile.private.json")))'
```

CLI alternative: `vercel env add JEFFY_PROFILE_JSON production` and paste the output. Same for the other names. Redeploy after any change; variables apply only to new deployments.

## 3. Keep production private

Jeffy has no sign-in, so protect the deployment itself.

1. Settings, Deployment Protection, Vercel Authentication: set to **All Deployments**. Vercel announced this covers production at no extra cost on all plans; older docs say Standard Protection leaves production domains public on Hobby, so verify.
2. Open the production domain in a private window. You should see Vercel's login, not Jeffy. If you see Jeffy, it is public.
3. Password Protection is an alternative on plans that include it.

Public demo: use a separate Vercel project (or the Preview environment) with no `JEFFY_PROFILE_JSON` and `VOICESTUDIO_VOICE_ID=alloy`.

## 4. Smoke test

1. Open the deployment while signed in to Vercel. The empty state reads "Type a question. Jeffy answers out loud."
2. Ask a question; audio should play within a few seconds.
3. If it fails, match the error to the table in the [README](../README.md#troubleshooting). Hosted audio needs your computer awake and online ([voicestudio.md](voicestudio.md#home-computer-caveat)).
