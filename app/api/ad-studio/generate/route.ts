import { NextResponse } from "next/server";
import sharp from "sharp";
import { startJob } from "@/lib/adstudio/jobs";
import { addEntries, getEntry, newId, saveFile } from "@/lib/adstudio/library";
import { parseRequest } from "@/lib/adstudio/request";
import {
  MAX_EXTRA_REFS,
  MAX_VARIATIONS,
  type AdEntry,
} from "@/lib/adstudio/types";

export const runtime = "nodejs";

const MAX_FINAL_PROMPT = 4000;
const MAX_UPLOAD_CHARS = 8_000_000;

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Stores uploaded reference images as JPEGs and returns their file names. */
async function saveUploads(uploads: unknown): Promise<string[] | { error: string }> {
  const files: string[] = [];
  for (const upload of Array.isArray(uploads) ? uploads.slice(0, MAX_EXTRA_REFS) : []) {
    const match =
      typeof upload === "string" && upload.length <= MAX_UPLOAD_CHARS
        ? /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(upload)
        : null;
    if (!match) return { error: "A reference image could not be read or is too large." };
    try {
      const jpeg = await sharp(Buffer.from(match[1], "base64"))
        .rotate()
        .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
      files.push(saveFile(`ref-${newId()}`, jpeg, "image/jpeg"));
    } catch {
      return { error: "A reference image is not a valid picture." };
    }
  }
  return files;
}

// Queues one or more generations and returns at once; the page then polls
// the library for progress.
export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return fail("GEMINI_API_KEY is not set. Add it to .env.local and restart the server.", 500);
  }
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

  // Regenerate or make variations of an existing library entry.
  if (typeof body.fromId === "string") {
    const original = getEntry(body.fromId);
    if (!original) return fail("That item is no longer in the library.", 404);
    const variation = body.variation === true && original.type === "image";
    const count = variation ? 2 : 1;
    const entries: AdEntry[] = Array.from({ length: count }, () => ({
      ...original,
      id: newId(),
      status: "queued",
      error: undefined,
      file: undefined,
      operation: undefined,
      createdAt: new Date().toISOString(),
    }));
    addEntries(entries);
    for (const entry of entries) startJob(entry, variation);
    return NextResponse.json({ entries });
  }

  const parsed = parseRequest(body);
  if ("error" in parsed) return fail(parsed.error);

  const finalPrompt = typeof body.finalPrompt === "string" ? body.finalPrompt.trim() : "";
  if (!finalPrompt) return fail("The final prompt is empty.");
  if (finalPrompt.length > MAX_FINAL_PROMPT) {
    return fail(`The final prompt is too long (max ${MAX_FINAL_PROMPT} characters).`);
  }

  const refFiles = await saveUploads(body.extraRefs);
  if ("error" in refFiles) return fail(refFiles.error);

  const source = parsed.sourceId ? getEntry(parsed.sourceId) : undefined;
  if (parsed.sourceId && (!source?.file || source.type !== "image")) {
    return fail("The image to animate is no longer in the library.", 404);
  }
  if (!parsed.products.length && !refFiles.length && !source) {
    return fail("Choose at least one product or add a reference image.");
  }

  const video = parsed.settings.type === "video";
  const count = video
    ? 1
    : Math.min(MAX_VARIATIONS, Math.max(1, Math.round(Number(body.variations) || 1)));
  const entries: AdEntry[] = Array.from({ length: count }, () => ({
    id: newId(),
    type: parsed.settings.type,
    status: "queued",
    prompt: parsed.prompt,
    finalPrompt,
    // An animated image keeps the products of the image it came from.
    products: parsed.products.length ? parsed.products : (source?.products ?? []),
    settings: parsed.settings,
    createdAt: new Date().toISOString(),
    refFiles,
    sourceId: video ? source?.id : undefined,
  }));
  addEntries(entries);
  // With several images, all but the first are asked to differ.
  entries.forEach((entry, index) => startJob(entry, index > 0));
  return NextResponse.json({ entries });
}
