# Jeffy profile

`example.profile.json` is a fictional example ("Riley Park"). To use your own, copy it to
`profile.private.json` in this folder, which is gitignored, and edit it. Alternatively set
`JEFFY_PROFILE_JSON` to the JSON string. On Vercel preview deployments both are ignored and the example is used.

Schema:

```
{ "name": string, "summary": string, "style": string,
  "phrases": string[],
  "facts":       [{ "topic": string, "keywords": string[], "text": string }],
  "preferences": [{ "topic": string, "keywords": string[], "text": string }],
  "examples":    [{ "question": string, "answer": string, "keywords"?: string[] }] }
```

Only the few items relevant to each question are sent to the model. `summary` is never sent.
