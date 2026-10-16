// The saved Ad Studio library: one JSON index plus the media files, kept on
// the server's disk under data/ad-studio.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AdEntry } from "@/lib/adstudio/types";

// DATA_DIR lets a host point this at a persistent disk.
const ROOT = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "ad-studio");
const INDEX = path.join(ROOT, "library.json");

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};
const MIME_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, extension]) => [extension, mime]),
);

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

export function readLibrary(): AdEntry[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8")) as AdEntry[];
  } catch {
    return [];
  }
}

function writeLibrary(entries: AdEntry[]) {
  ensureRoot();
  // Write then rename so a crash never leaves a half-written index.
  const temporary = `${INDEX}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(entries, null, 2));
  fs.renameSync(temporary, INDEX);
}

export function newId(): string {
  return randomUUID();
}

export function addEntries(entries: AdEntry[]) {
  writeLibrary([...entries, ...readLibrary()]);
}

export function getEntry(id: string): AdEntry | undefined {
  return readLibrary().find((entry) => entry.id === id);
}

export function updateEntry(id: string, patch: Partial<AdEntry>) {
  writeLibrary(
    readLibrary().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  );
}

/** Saves media and returns its file name. */
export function saveFile(name: string, data: Buffer, mimeType: string): string {
  ensureRoot();
  const file = `${name}.${EXTENSIONS[mimeType] ?? "bin"}`;
  fs.writeFileSync(path.join(ROOT, file), data);
  return file;
}

/** Reads a stored file; names are checked so nothing outside ROOT is reachable. */
export function readFile(file: string): { data: Buffer; mimeType: string } | null {
  if (!/^[\w-]+\.\w+$/.test(file)) return null;
  try {
    return {
      data: fs.readFileSync(path.join(ROOT, file)),
      mimeType: MIME_TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

function removeFile(file: string) {
  if (!/^[\w-]+\.\w+$/.test(file)) return;
  fs.rmSync(path.join(ROOT, file), { force: true });
}

export function deleteEntry(id: string): boolean {
  const entries = readLibrary();
  const entry = entries.find((item) => item.id === id);
  if (!entry) return false;
  const remaining = entries.filter((item) => item.id !== id);
  writeLibrary(remaining);
  if (entry.file) removeFile(entry.file);
  // Reference uploads can be shared by variations of the same request.
  for (const ref of entry.refFiles) {
    if (!remaining.some((item) => item.refFiles.includes(ref))) removeFile(ref);
  }
  return true;
}
