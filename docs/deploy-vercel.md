# Deploy to Vercel

With the default Gradium voice no computer needs to stay on and no gateway or Tailscale is needed. Only the optional VoiceStudio path ([voicestudio.md](voicestudio.md)) needs the authenticated gateway running and `verify-gateway.sh` passing.

## 1. Import

Vercel dashboard, Add New, Project, import this repo. Framework preset Next.js, default build settings. The chat route sets `maxDuration = 60` (seconds); Vercel's request and response limit is 4.5 MB (Jeffy rejects request bodies over 4.4 MB; attachments are capped at 3 MB decoded). WAV is about 48 KB/s, fine for short replies. If VoiceStudio has ffmpeg, set `VOICESTUDIO_RESPONSE_FORMAT=mp3` for smaller responses.

## 2. Environment variables

Project Settings, Environment Variables. Mark secrets as Sensitive.

Text chat needs only `GOOGLE_GENERATIVE_AI_API_KEY`; the voice variables are needed only if you use voice or Talk mode.

Production (Gradium):

| Name | Value |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | your Gemini key (Sensitive) |
| `VOICE_PROVIDER` | `gradium` |
| `GRADIUM_API_KEY` | your Gradium key (Sensitive) |
| `GRADIUM_VOICE_ID` | your cloned voice uid |

Preview (Gradium): same `GOOGLE_GENERATIVE_AI_API_KEY`, `VOICE_PROVIDER`, `GRADIUM_API_KEY`, but `GRADIUM_VOICE_ID` is a built-in Gradium voice uid (`npm run voices:gradium`), never your clone.

Optional VoiceStudio instead (Production):

| Name | Value |
| --- | --- |
| `VOICE_PROVIDER` | `voicestudio` |
| `VOICESTUDIO_BASE_URL` | `https://<machine>.<tailnet>.ts.net` |
| `VOICESTUDIO_AUTH_TOKEN` | the gateway token (Sensitive) |
| `VOICESTUDIO_VOICE_ID` | your cloned voice profile id |

For Preview, set `VOICESTUDIO_VOICE_ID` to a built-in voice such as `alloy`, never your clone id.

Optional VoiceStudio Preview:

| Name | Value |
| --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key (Sensitive) |
| `VOICESTUDIO_BASE_URL`, `VOICESTUDIO_AUTH_TOKEN` | same as Production, or those of a separate public-demo gateway |
| `VOICESTUDIO_VOICE_ID` | a built-in voice such as `alloy`. Never the clone id |

CLI alternative: `vercel env add GOOGLE_GENERATIVE_AI_API_KEY production`, and the same for the other names. Redeploy after any change; variables apply only to new deployments.

## 3. Keep production private

Jeffy has no sign-in, so protect the deployment itself.

1. Settings, Deployment Protection, Vercel Authentication: set to **All Deployments**. Vercel announced this covers production at no extra cost on all plans; older docs say Standard Protection leaves production domains public on Hobby, so verify.
2. Open the production domain in a private window. You should see Vercel's login, not Jeffy. If you see Jeffy, it is public.
3. Password Protection is an alternative on plans that include it.

Public demo: use a separate Vercel project (or the Preview environment) with a built-in voice (`VOICESTUDIO_VOICE_ID=alloy` or a built-in `GRADIUM_VOICE_ID`), never your clone.

## 4. Smoke test

1. Open the deployment while signed in to Vercel. Jeffy's chat opens with suggestions and the message box.
2. Ask a question; the answer should stream in. Turn the voice toggle on and ask again; audio should play within a few seconds.
3. If it fails, match the error to the table in the [README](../README.md#troubleshooting). With VoiceStudio, hosted audio needs your computer awake and online ([voicestudio.md](voicestudio.md#home-computer-caveat)).
