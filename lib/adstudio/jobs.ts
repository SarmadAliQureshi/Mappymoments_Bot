// Runs generations in the background of the server process and records the
// outcome in the library, so the page only has to poll the library.

import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseVideoScript, type VideoScript } from "@/lib/adstudio/enrich";
import {
  getEntry,
  readFile,
  readLibrary,
  saveFile,
  updateEntry,
} from "@/lib/adstudio/library";
import {
  getProvider,
  providerMessage,
  type MediaData,
} from "@/lib/adstudio/providers";
import type { AdAspect, AdEntry } from "@/lib/adstudio/types";
import { getProduct } from "@/lib/products";

const MAX_PRODUCT_REFS = 6;
const POLL_MS = 8_000;
const VIDEO_TIMEOUT_MS = 12 * 60_000;

// Jobs this process is working on. Kept on globalThis because each API route
// gets its own copy of this module in development.
const store = globalThis as typeof globalThis & { __adStudioActive?: Set<string> };
const active = (store.__adStudioActive ??= new Set<string>());

const FRAME_SIZES: Record<AdAspect, [number, number]> = {
  "1:1": [1024, 1024],
  "4:5": [1024, 1280],
  "9:16": [720, 1280],
  "16:9": [1280, 720],
};

async function toJpeg(data: Buffer, maxSide = 1536): Promise<MediaData> {
  return {
    data: await sharp(data)
      .rotate()
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer(),
    mimeType: "image/jpeg",
  };
}

/** A catalogue photo, downloaded once from mappymoments.com and cached. */
async function productPhoto(url: string): Promise<MediaData> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "mappymoments.com") {
    throw new Error("Product photos can only come from mappymoments.com.");
  }
  const name = `cache-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
  const cached = readFile(`${name}.jpg`);
  if (cached) return cached;

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`The product photo could not be loaded (${response.status}).`);
  }
  const photo = await toJpeg(Buffer.from(await response.arrayBuffer()));
  saveFile(name, photo.data, photo.mimeType);
  return photo;
}

async function references(entry: AdEntry): Promise<MediaData[]> {
  const urls: string[] = [];
  const perProduct = entry.products.length > 2 ? 1 : 2;
  for (const choice of entry.products) {
    urls.push(...(getProduct(choice.productId)?.images.slice(0, perProduct) ?? []));
  }
  const photos = await Promise.all(urls.slice(0, MAX_PRODUCT_REFS).map(productPhoto));
  const uploads = entry.refFiles
    .map((file) => readFile(file))
    .filter((file): file is MediaData => !!file);
  return [...photos, ...uploads];
}

async function runImage(entry: AdEntry, variation: boolean) {
  const image = await getProvider().generateImage({
    prompt: variation
      ? `${entry.finalPrompt}\n\nMake this a fresh variation: keep the product and the idea, but change the camera angle, composition and supporting props.`
      : entry.finalPrompt,
    aspect: entry.settings.aspect,
    references: await references(entry),
  });
  updateEntry(entry.id, {
    status: "done",
    file: saveFile(entry.id, image.data, image.mimeType),
  });
}

async function toFrame(still: MediaData, aspect: AdAspect): Promise<MediaData> {
  const [width, height] = FRAME_SIZES[aspect];
  return {
    data: await sharp(still.data)
      .resize(width, height, { fit: "cover" })
      .jpeg({ quality: 92 })
      .toBuffer(),
    mimeType: "image/jpeg",
  };
}

/**
 * The stills the video runs between. A story such as an unboxing gets two:
 * the closed box first, then the same set with the product revealed.
 */
async function videoFrames(
  entry: AdEntry,
  script: VideoScript,
): Promise<{ first: MediaData; last?: MediaData }> {
  const { aspect } = entry.settings;

  if (entry.sourceId) {
    const source = getEntry(entry.sourceId);
    const still = source?.file ? readFile(source.file) : null;
    if (!still) throw new Error("The image to animate is no longer in the library.");
    return { first: await toFrame(still, aspect) };
  }

  const provider = getProvider();
  const photos = await references(entry);
  const opening = await provider.generateImage({
    prompt: `${
      script.opening ??
      `${entry.finalPrompt}\n\nThis is the opening frame of the video: show the scene at rest.`
    }\n\nThis is a photograph, the first frame of a video. The attached images are reference photos of the real product: if the description says the product is hidden or not visible, do not show it anywhere; otherwise it must look exactly like the references.`,
    aspect,
    references: photos,
  });
  if (!script.closing) return { first: await toFrame(opening, aspect) };

  const closing = await provider.generateImage({
    prompt: `The first attached image is the opening frame of a video. Create the closing frame of the same video: the very same set, camera position, framing, surface, props, packaging and light, changed only as described here: ${script.closing}\n\nThe other attached images are reference photos of the real product; where it appears it must look exactly like them, with the same printed map artwork, colours and frame or base material.`,
    aspect,
    references: [opening, ...photos],
  });
  return {
    first: await toFrame(opening, aspect),
    last: await toFrame(closing, aspect),
  };
}

async function pollVideo(entry: AdEntry, operation: string) {
  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    // Deleted while generating: stop quietly.
    if (!getEntry(entry.id)) return;
    const status = await getProvider().checkVideo(operation);
    if (status.done) {
      if (!status.video) throw new Error(status.error ?? "The video could not be made.");
      updateEntry(entry.id, {
        status: "done",
        operation: undefined,
        file: saveFile(entry.id, status.video.data, status.video.mimeType),
      });
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("The video took too long and was abandoned. Please try again.");
    }
  }
}

async function runVideo(entry: AdEntry) {
  const script = parseVideoScript(entry.finalPrompt);
  const frames = await videoFrames(entry, script);
  const operation = await getProvider().startVideo({
    prompt: script.video,
    aspect: entry.settings.aspect,
    duration: entry.settings.duration,
    firstFrame: frames.first,
    lastFrame: frames.last,
  });
  updateEntry(entry.id, { operation });
  await pollVideo(entry, operation);
}

function track(entry: AdEntry, work: () => Promise<void>) {
  active.add(entry.id);
  void work()
    .catch((error) => {
      console.error("[ad-studio]", entry.id, error);
      updateEntry(entry.id, {
        status: "failed",
        operation: undefined,
        error: providerMessage(error),
      });
    })
    .finally(() => active.delete(entry.id));
}

/** Starts a queued entry; returns straight away. */
export function startJob(entry: AdEntry, variation = false) {
  track(entry, async () => {
    updateEntry(entry.id, { status: "generating" });
    if (entry.type === "video") await runVideo(entry);
    else await runImage(entry, variation);
  });
}

/**
 * Picks up work that a server restart left behind: videos carry on from the
 * provider's job handle, anything else is marked failed so it can be retried.
 */
export function recoverJobs() {
  for (const entry of readLibrary()) {
    if (entry.status !== "queued" && entry.status !== "generating") continue;
    if (active.has(entry.id)) continue;
    if (entry.type === "video" && entry.operation) {
      const operation = entry.operation;
      track(entry, () => pollVideo(entry, operation));
    } else {
      updateEntry(entry.id, {
        status: "failed",
        error: "The server restarted before this finished. Please retry.",
      });
    }
  }
}
