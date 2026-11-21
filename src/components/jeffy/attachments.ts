import {
  ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Attachment,
  type AttachmentMime,
} from "@/lib/api-types";

/** A file picked in the composer, already read as base64. */
export type PendingFile = Attachment & { id: string; size: number; previewUrl?: string };

export const ACCEPT = [...ATTACHMENT_MIMES, ".md", ".markdown", ".txt"].join(",");

export function mimeFor(file: { name: string; type: string }): AttachmentMime | null {
  const t = file.type.toLowerCase();
  if ((ATTACHMENT_MIMES as readonly string[]).includes(t)) return t as AttachmentMime;
  if (t === "image/jpg") return "image/jpeg";
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "text/markdown";
  if (ext === "txt") return "text/plain";
  return null;
}

export const isImage = (mime: string) => mime.startsWith("image/");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Splits `files` into what fits the limits and a warning for the rest. */
export function fitFiles<F extends { name: string; type: string; size: number }>(
  existing: { size: number }[],
  files: F[],
): { accepted: { file: F; mime: AttachmentMime }[]; warning: string | null } {
  const accepted: { file: F; mime: AttachmentMime }[] = [];
  const problems: string[] = [];
  let count = existing.length;
  let bytes = existing.reduce((s, f) => s + f.size, 0);
  for (const file of files) {
    const mime = mimeFor(file);
    if (!mime) {
      problems.push(`${file.name} isn't a supported type (images, PDF, text or markdown).`);
      continue;
    }
    if (count >= MAX_ATTACHMENTS) {
      problems.push(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      break;
    }
    if (bytes + file.size > MAX_ATTACHMENT_BYTES) {
      problems.push(`${file.name} would go over the ${formatBytes(MAX_ATTACHMENT_BYTES)} total limit.`);
      continue;
    }
    count++;
    bytes += file.size;
    accepted.push({ file, mime });
  }
  return { accepted, warning: problems.length ? Array.from(new Set(problems)).join(" ") : null };
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function splitDataUrl(url: string): { mediaType: string; base64: string } | null {
  const m = url.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/);
  return m ? { mediaType: m[1], base64: m[2] } : null;
}
