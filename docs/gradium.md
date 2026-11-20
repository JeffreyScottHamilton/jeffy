# Gradium (default voice)

[Gradium](https://gradium.ai) is hosted text-to-speech with voice cloning. Jeffy sends it only the reply text; no computer of yours needs to stay on.

## Sign up

Create an account at gradium.ai and an API key. The free plan reportedly includes monthly credits and instant voice clones for non-commercial use: check gradium.ai/pricing.

## Clone your voice

Record 10 to 30 seconds of clean speech (wav), then:

```bash
GRADIUM_API_KEY=... npm run clone:gradium -- recording.wav "My voice" en
```

It prints the voice uid. Set `GRADIUM_VOICE_ID` to it in `.env.local` and in Vercel. You can also clone in the Gradium web app and copy the uid. Only clone your own voice.

## Try a built-in voice

```bash
GRADIUM_API_KEY=... npm run voices:gradium     # uid and name per line
```

Use one of those uids as `GRADIUM_VOICE_ID`. Use a built-in voice for Vercel Preview.

## Settings

`VOICE_PROVIDER=gradium` (default when `GRADIUM_API_KEY` is set), `GRADIUM_API_KEY`, `GRADIUM_VOICE_ID`, optional `VOICE_TIMEOUT_MS` (default 40000; with Gemini's 15 s it stays under the 60 s function limit).

## When the allowance runs out

Jeffy shows "The free voice allowance is used up for this month." (`voice_quota`, not retryable). Wait for the monthly reset or upgrade. Rate limiting (`voice_busy`) is temporary: retry.

## Privacy

Gradium stores the voice sample you upload and receives each reply text. See [privacy.md](privacy.md).
