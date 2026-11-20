// Usage:
//   GRADIUM_API_KEY=... node scripts/gradium-clone.mjs recording.wav "My voice" [language]
//   GRADIUM_API_KEY=... node scripts/gradium-clone.mjs --list
// The key is read from the environment only. Prints the voice uid, never the key.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { GradiumClient } from "@gradium/sdk";

const apiKey = process.env.GRADIUM_API_KEY?.trim();
if (!apiKey) {
  console.error("Set GRADIUM_API_KEY in the environment (get a free key at https://gradium.ai).");
  process.exit(1);
}
const client = new GradiumClient({ apiKey });
const [first, name, language = "en"] = process.argv.slice(2);

try {
  if (first === "--list") {
    const res = await client.voiceList({ includeCatalog: true });
    const voices = Array.isArray(res) ? res : (res?.voices ?? res?.items ?? []);
    for (const v of voices) console.log(`${v.uid}\t${v.name ?? ""}`);
  } else if (first && name) {
    const buf = await readFile(first);
    const voice = await client.voiceCreate(buf, { name, language, filename: basename(first) });
    console.log(voice.uid);
    console.log(`\nVoice created. Set GRADIUM_VOICE_ID=${voice.uid} in .env.local (and in Vercel).`);
  } else {
    console.error('Usage: npm run clone:gradium -- recording.wav "My voice" [language]\n       npm run voices:gradium');
    process.exit(1);
  }
} catch (e) {
  console.error(`Gradium request failed${e?.status ? ` (HTTP ${e.status})` : ""}. Check the key, file and your plan.`);
  process.exit(1);
}
