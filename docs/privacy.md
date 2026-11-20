# Privacy: what goes where

| Party | Receives |
| --- | --- |
| Browser | Your typed question; audio replies. The reply text is kept in memory only, as follow-up context, and never shown. |
| Jeffy server (Vercel) | The question and up to the last 4 turns, per request. It stores nothing: no database, no logs of content. |
| Gemini (Google) | Selected profile excerpts only (name, style, up to 4 phrases, up to 6 relevant facts or preferences, up to 2 examples; not the whole profile and not the summary), the last 4 turns, and the question. |
| Gradium (default voice) | The generated reply text, plus your voice id, over TLS. It also stores the voice sample you upload to create the clone. |
| VoiceStudio (optional) | Only the generated reply text, plus your voice id. |
| VoiceStudio machine (optional) | Your reference recordings. They stay there: never upload them to Vercel or git. |

Gemini data use depends on your tier. Check Google's Gemini API terms for your tier; free-tier data may be used to improve Google's products. Use a paid tier if that matters.

## Secrets

- API keys and tokens are read from server environment variables only; none use `NEXT_PUBLIC_` and none reach client code.
- `.env.local` and `profile/profile.private.json` are gitignored. `.env.example` holds placeholders only.
- Server logs contain error codes and HTTP statuses only: never questions, replies, profile text, keys or tokens.
- Jeffy has no sign-in. Anyone who can open the site can spend your Gemini quota and hear your cloned voice. Keep production behind Vercel Deployment Protection ([deploy-vercel.md](deploy-vercel.md)).
- Only clone your own voice, and keep the "AI-generated voice" label.
