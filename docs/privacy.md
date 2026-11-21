# Privacy: what goes where

| Party | Receives |
| --- | --- |
| Browser | Your chats (questions, replies, reasoning, sources, small image previews) in localStorage on that device. Audio is not stored. Clear it by deleting the chats or the site data. |
| Jeffy server (Vercel) | The message, up to the last 12 turns, and any attachments, per request. It stores nothing: no database, no logs of content. |
| Gemini (Google) | The system prompt, the message, up to the last 12 turns, and the current message's attachments. With search on, Google Search runs queries derived from your message. |
| Gradium (default voice) | Only when voice is on (or in Talk mode): the speakable reply text, plus your voice id, over TLS. It also stores the voice sample you upload to create the clone. |
| VoiceStudio (optional) | Only when voice is on (or in Talk mode): the speakable reply text, plus your voice id. |
| VoiceStudio machine (optional) | Your reference recordings. They stay there: never upload them to Vercel or git. |

Gemini data use depends on your tier. Check Google's Gemini API terms for your tier; free-tier data may be used to improve Google's products. Use a paid tier if that matters.

## Secrets

- API keys and tokens are read from server environment variables only; none use `NEXT_PUBLIC_` and none reach client code.
- `.env.local` is gitignored. `.env.example` holds placeholders only.
- Server logs contain error codes and HTTP statuses only: never questions, replies, attachments, keys or tokens.
- Jeffy has no sign-in. Anyone who can open the site can spend your Gemini quota and hear your cloned voice. Keep production behind Vercel Deployment Protection ([deploy-vercel.md](deploy-vercel.md)).
- Only clone your own voice, and keep the "AI-generated voice" label.
