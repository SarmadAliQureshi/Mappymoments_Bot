"use client";

import { useRef } from "react";
import type { AdEntry } from "@/lib/adstudio/types";
import { getProduct } from "@/lib/products";

const STATUS_LABEL: Record<AdEntry["status"], string> = {
  queued: "Queued",
  generating: "Generating",
  done: "Done",
  failed: "Failed",
};

const ASPECT_CLASS: Record<AdEntry["settings"]["aspect"], string> = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
};

export function productNames(entry: AdEntry): string {
  return (
    entry.products
      .map((choice) => getProduct(choice.productId)?.name)
      .filter(Boolean)
      .join(", ") || "Reference images"
  );
}

interface ResultCardProps {
  entry: AdEntry;
  onRegenerate: () => void;
  onVariations: () => void;
  onAnimate: () => void;
  onDelete: () => void;
}

const action =
  "rounded-lg border border-ink/20 bg-offwhite px-2.5 py-1.5 text-xs font-bold text-ink transition hover:border-terracotta hover:text-terracotta focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40";

export default function ResultCard({
  entry,
  onRegenerate,
  onVariations,
  onAnimate,
  onDelete,
}: ResultCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = entry.file ? `/api/ad-studio/media/${entry.file}` : null;
  const pending = entry.status === "queued" || entry.status === "generating";
  const names = productNames(entry);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-tobacco/20 bg-offwhite shadow-soft">
      <div className={`relative w-full bg-parchment ${ASPECT_CLASS[entry.settings.aspect]}`}>
        {url && entry.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Ad image of ${names}`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {url && entry.type === "video" && (
          <video
            ref={videoRef}
            src={url}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={`Ad video of ${names}`}
            onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
            onMouseLeave={() => videoRef.current?.pause()}
            onFocus={() => void videoRef.current?.play().catch(() => undefined)}
            onBlur={() => videoRef.current?.pause()}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play().catch(() => undefined);
              else video.pause();
            }}
            tabIndex={0}
            className="absolute inset-0 h-full w-full cursor-pointer object-cover"
          />
        )}
        {pending && (
          <div
            role="status"
            aria-live="polite"
            className="shimmer absolute inset-0 flex animate-shimmer flex-col items-center justify-center px-4 text-center"
          >
            <p className="font-serif text-lg text-ink">
              {STATUS_LABEL[entry.status]}…
            </p>
            <p className="mt-1 text-xs text-ink/60">
              {entry.type === "video"
                ? "A video can take a few minutes. You can keep working."
                : "Usually under a minute."}
            </p>
          </div>
        )}
        {entry.status === "failed" && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto p-4 text-center"
          >
            <p className="text-sm font-bold text-terracotta">Generation failed</p>
            <p className="text-xs leading-relaxed text-ink/80">{entry.error}</p>
            <button type="button" onClick={onRegenerate} className={action}>
              Retry
            </button>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-offwhite">
          {entry.type}
          {entry.type === "video" ? ` · ${entry.settings.duration}s` : ""}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-bold text-ink">{names}</p>
        <p className="line-clamp-2 text-xs text-ink/70" title={entry.finalPrompt}>
          {entry.prompt || entry.finalPrompt}
        </p>
        <p className="text-[11px] text-ink/50">
          {entry.settings.aspect} ·{" "}
          {new Date(entry.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {url && (
            <a href={`${url}?download`} download className={action}>
              Download
            </a>
          )}
          {!pending && entry.status !== "failed" && (
            <button type="button" onClick={onRegenerate} className={action}>
              Regenerate
            </button>
          )}
          {url && entry.type === "image" && (
            <>
              <button type="button" onClick={onVariations} className={action}>
                Make variations
              </button>
              <button type="button" onClick={onAnimate} className={action}>
                Animate this image
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDelete}
            className={`${action} ml-auto border-transparent bg-transparent text-ink/60`}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
