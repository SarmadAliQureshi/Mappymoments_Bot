"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResultCard from "@/components/adstudio/ResultCard";
import { Segmented } from "@/components/PromptInput";
import {
  AD_STYLES,
  ASPECTS,
  DURATIONS,
  MAX_EXTRA_REFS,
  MAX_VARIATIONS,
  MOTION_PRESETS,
  type AdEntry,
  type AdProductChoice,
  type AdSettings,
  type AdType,
} from "@/lib/adstudio/types";
import { PRODUCTS, formatPrice, getProduct, getSize } from "@/lib/products";

const label = "text-xs font-bold uppercase tracking-widest text-ink/60";
const field =
  "w-full rounded-xl border border-tobacco/25 bg-parchment/50 px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25";
const smallField =
  "rounded-lg border border-tobacco/25 bg-parchment/50 px-2 py-1.5 text-sm text-ink focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25";
const chip =
  "rounded-full border px-3.5 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40";

const EXAMPLES = [
  "Show how the wooden framed map would look on a living room wall with a plant beside it",
  "Create a short video of the mug rotating 360° with an elegant background",
];

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? fallback);
  return data;
}

/** Shrinks an uploaded picture so it is quick to send. */
function readUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`"${file.name}" is not a picture this browser can read.`));
    };
    image.src = url;
  });
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className={label}>{title}</h3>
      {hint && <p className="mt-1 text-sm text-ink/70">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function AdStudioPage() {
  const [library, setLibrary] = useState<AdEntry[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [sessionIds, setSessionIds] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdProductChoice[]>([]);
  const [extraRefs, setExtraRefs] = useState<string[]>([]);
  const [source, setSource] = useState<AdEntry | null>(null);
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<AdSettings>({
    type: "image",
    aspect: "1:1",
    styleId: null,
    duration: DURATIONS[0],
    motionId: MOTION_PRESETS[0].id,
  });
  const [variations, setVariations] = useState(1);
  const [finalPrompt, setFinalPrompt] = useState("");
  // The inputs the final prompt was written from, to tell when it is stale.
  const [finalFor, setFinalFor] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [filterProduct, setFilterProduct] = useState("all");
  const [filterType, setFilterType] = useState<"all" | AdType>("all");
  const formRef = useRef<HTMLDivElement>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const data = await readJson(
        await fetch("/api/ad-studio/library", { cache: "no-store" }),
        "The library could not be loaded.",
      );
      setLibrary(data.entries);
      setLibraryError(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "The library could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // Poll only while something is still being made.
  const hasPending = !!library?.some(
    (entry) => entry.status === "queued" || entry.status === "generating",
  );
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void loadLibrary(), 3000);
    return () => clearInterval(timer);
  }, [hasPending, loadLibrary]);

  const video = settings.type === "video";
  const aspects = ASPECTS.filter((aspect) => !video || aspect.video);
  const signature = JSON.stringify([prompt.trim(), selected, settings, source?.id ?? null]);
  const finalStale = finalPrompt !== "" && finalFor !== signature;
  const hasSubject = selected.length > 0 || extraRefs.length > 0 || !!source;
  const canGenerate = !submitting && !enriching && hasSubject && prompt.trim() !== "";

  function patchSettings(patch: Partial<AdSettings>) {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      // Video comes in two shapes only.
      if (next.type === "video" && !ASPECTS.find((a) => a.value === next.aspect)?.video) {
        next.aspect = "9:16";
      }
      return next;
    });
  }

  function toggleProduct(productId: string) {
    setSelected((previous) => {
      if (previous.some((choice) => choice.productId === productId)) {
        return previous.filter((choice) => choice.productId !== productId);
      }
      const product = getProduct(productId)!;
      return [
        ...previous,
        {
          productId,
          sizeId: product.sizes[0].id,
          finishId: product.finishes?.[0].id ?? "",
        },
      ];
    });
  }

  function patchChoice(productId: string, patch: Partial<AdProductChoice>) {
    setSelected((previous) =>
      previous.map((choice) =>
        choice.productId === productId ? { ...choice, ...patch } : choice,
      ),
    );
  }

  async function addUploads(files: FileList | null) {
    if (!files?.length) return;
    setFormError(null);
    try {
      const room = MAX_EXTRA_REFS - extraRefs.length;
      const added = await Promise.all(Array.from(files).slice(0, room).map(readUpload));
      setExtraRefs((previous) => [...previous, ...added].slice(0, MAX_EXTRA_REFS));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "That picture could not be read.");
    }
  }

  async function enrich(): Promise<string | null> {
    setEnriching(true);
    setFormError(null);
    try {
      const data = await readJson(
        await fetch("/api/ad-studio/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            products: selected,
            settings,
            sourceId: source?.id,
          }),
        }),
        "The final prompt could not be written.",
      );
      setFinalPrompt(data.finalPrompt);
      setFinalFor(signature);
      return data.finalPrompt as string;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The final prompt could not be written.");
      return null;
    } finally {
      setEnriching(false);
    }
  }

  function addToSession(entries: AdEntry[]) {
    setLibrary((previous) => [...entries, ...(previous ?? [])]);
    setSessionIds((previous) => [...entries.map((entry) => entry.id), ...previous]);
  }

  async function generate() {
    if (!canGenerate) return;
    // Write the final prompt first unless the user already has a current one
    // (which they may have edited).
    const final = finalPrompt && !finalStale ? finalPrompt : await enrich();
    if (!final) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const data = await readJson(
        await fetch("/api/ad-studio/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            finalPrompt: final,
            products: selected,
            settings,
            variations,
            extraRefs,
            sourceId: video ? source?.id : undefined,
          }),
        }),
        "The generation could not be started.",
      );
      addToSession(data.entries);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The generation could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  async function repeat(entry: AdEntry, variation: boolean) {
    setLibraryError(null);
    try {
      const data = await readJson(
        await fetch("/api/ad-studio/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromId: entry.id, variation }),
        }),
        "The generation could not be started.",
      );
      addToSession(data.entries);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "The generation could not be started.");
    }
  }

  // Sets the form up to turn a library image into a video.
  function animate(entry: AdEntry) {
    setSource(entry);
    setSelected(entry.products);
    if (!prompt.trim()) setPrompt(entry.prompt);
    patchSettings({
      type: "video",
      aspect: ASPECTS.find((a) => a.value === entry.settings.aspect)?.video
        ? entry.settings.aspect
        : "9:16",
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function remove(entry: AdEntry) {
    if (!window.confirm("Delete this from the library? This cannot be undone.")) return;
    try {
      await readJson(
        await fetch(`/api/ad-studio/library/${entry.id}`, { method: "DELETE" }),
        "That item could not be deleted.",
      );
      setLibrary((previous) => previous?.filter((item) => item.id !== entry.id) ?? null);
      if (source?.id === entry.id) setSource(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "That item could not be deleted.");
    }
  }

  const visibleProducts = PRODUCTS.filter((product) =>
    product.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const sessionEntries = useMemo(
    () => (library ?? []).filter((entry) => sessionIds.includes(entry.id)),
    [library, sessionIds],
  );
  const libraryEntries = (library ?? []).filter(
    (entry) =>
      (filterType === "all" || entry.type === filterType) &&
      (filterProduct === "all" ||
        entry.products.some((choice) => choice.productId === filterProduct)),
  );

  const grid = (entries: AdEntry[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <ResultCard
          key={entry.id}
          entry={entry}
          onRegenerate={() => void repeat(entry, false)}
          onVariations={() => void repeat(entry, true)}
          onAnimate={() => animate(entry)}
          onDelete={() => void remove(entry)}
        />
      ))}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="text-center">
        <h1 className="font-serif text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Ad Studio
        </h1>
        <p className="mt-3 text-xs uppercase tracking-[0.25em] text-ink/70 sm:text-sm">
          Ad images &amp; short videos of your products
        </p>
        <div className="mx-auto mt-5 h-px w-16 bg-brass" />
      </header>

      <div
        ref={formRef}
        className="scroll-mt-16 rounded-xl border border-tobacco/20 bg-offwhite p-5 shadow-soft sm:p-7"
      >
        <Section
          title="Products"
          hint="Pick what the ad shows. Its real catalogue photos are given to the model so the result shows your actual product."
        >
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className={field}
          />
          {visibleProducts.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">
              No product matches “{search}”.
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {visibleProducts.map((product) => {
                const chosen = selected.some((choice) => choice.productId === product.id);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => toggleProduct(product.id)}
                      className={`block w-full overflow-hidden rounded-xl border-2 bg-parchment text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${
                        chosen
                          ? "border-terracotta"
                          : "border-tobacco/20 hover:border-tobacco/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.images[0]}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      <span
                        className={`block px-2 py-1.5 text-sm ${
                          chosen ? "font-bold text-terracotta" : "text-ink"
                        }`}
                      >
                        {product.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected.length > 0 && (
            <ul className="mt-4 space-y-2">
              {selected.map((choice) => {
                const product = getProduct(choice.productId)!;
                const size = getSize(product, choice.sizeId);
                return (
                  <li
                    key={choice.productId}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-parchment px-3 py-2 text-sm text-ink"
                  >
                    <span className="mr-auto font-bold">{product.name}</span>
                    <select
                      aria-label={`${product.name} size`}
                      value={size.id}
                      onChange={(event) =>
                        patchChoice(product.id, { sizeId: event.target.value })
                      }
                      className={smallField}
                    >
                      {product.sizes.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {product.finishes && (
                      <select
                        aria-label={`${product.name} finish`}
                        value={choice.finishId}
                        onChange={(event) =>
                          patchChoice(product.id, { finishId: event.target.value })
                        }
                        className={smallField}
                      >
                        {product.finishes.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="text-ink/60">{formatPrice(size.priceUsd)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {extraRefs.map((url, index) => (
              <div key={url.slice(-40) + index} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Extra reference ${index + 1}`}
                  className="h-16 w-16 rounded-lg border border-tobacco/25 object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove extra reference ${index + 1}`}
                  onClick={() =>
                    setExtraRefs((previous) => previous.filter((_, i) => i !== index))
                  }
                  className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-ink text-sm leading-none text-offwhite focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta"
                >
                  ×
                </button>
              </div>
            ))}
            {extraRefs.length < MAX_EXTRA_REFS && (
              <label className="cursor-pointer rounded-xl border border-dashed border-tobacco/40 px-4 py-3 text-sm text-ink/80 transition hover:border-terracotta hover:text-terracotta focus-within:ring-2 focus-within:ring-terracotta/40">
                + Add reference images (optional)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    void addUploads(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </Section>

        <Section title="Prompt">
          {source && (
            <p className="mb-3 flex items-center gap-3 rounded-xl bg-parchment px-3 py-2 text-sm text-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/ad-studio/media/${source.file}`}
                alt=""
                className="h-12 w-12 rounded-lg object-cover"
              />
              <span className="mr-auto">
                Animating this image: it will be the first frame of the video.
              </span>
              <button
                type="button"
                onClick={() => setSource(null)}
                className="text-terracotta underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </p>
          )}
          <textarea
            rows={3}
            value={prompt}
            maxLength={2000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={EXAMPLES[0]}
            aria-label="Describe the ad"
            className={`resize-y leading-relaxed ${field}`}
          />
          {!prompt && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="text-left text-terracotta underline-offset-2 hover:underline"
                >
                  Try: “{example}”
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {AD_STYLES.map((style) => {
              const on = settings.styleId === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patchSettings({ styleId: on ? null : style.id })}
                  className={`${chip} ${
                    on
                      ? "border-ink bg-ink text-offwhite"
                      : "border-tobacco/30 bg-parchment text-ink hover:border-terracotta hover:text-terracotta"
                  }`}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Output">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <p className="mb-2 text-sm text-ink/70">Type</p>
              <Segmented
                name="Output type"
                options={[
                  { value: "image", label: "Image" },
                  { value: "video", label: "Video" },
                ]}
                value={settings.type}
                onChange={(type) => patchSettings({ type })}
              />
            </div>
            <div>
              <p className="mb-2 text-sm text-ink/70">Aspect ratio</p>
              <Segmented
                name="Aspect ratio"
                options={aspects}
                value={settings.aspect}
                onChange={(aspect) => patchSettings({ aspect })}
              />
            </div>
            {video ? (
              <>
                <div>
                  <p className="mb-2 text-sm text-ink/70">Duration</p>
                  <Segmented
                    name="Duration"
                    options={DURATIONS.map((seconds) => ({
                      value: String(seconds),
                      label: `${seconds}s`,
                    }))}
                    value={String(settings.duration)}
                    onChange={(value) =>
                      patchSettings({
                        duration: DURATIONS.find((d) => String(d) === value) ?? DURATIONS[0],
                      })
                    }
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm text-ink/70">Motion</p>
                  <Segmented
                    name="Motion"
                    options={MOTION_PRESETS.map((motion) => ({
                      value: motion.id,
                      label: motion.label,
                    }))}
                    value={settings.motionId}
                    onChange={(motionId) => patchSettings({ motionId })}
                  />
                </div>
              </>
            ) : (
              <div>
                <p className="mb-2 text-sm text-ink/70">Variations</p>
                <Segmented
                  name="Number of variations"
                  options={Array.from({ length: MAX_VARIATIONS }, (_, index) => ({
                    value: String(index + 1),
                    label: String(index + 1),
                  }))}
                  value={String(variations)}
                  onChange={(value) => setVariations(Number(value))}
                />
              </div>
            )}
          </div>
          {video && (
            <p className="mt-3 text-sm text-ink/70">
              Video is made in Story/Reel or Landscape, at 4, 6 or 8 seconds;
              those are the shapes and lengths the video model offers. An
              unboxing or other reveal is always 8 seconds.
            </p>
          )}
        </Section>

        <details className="group mt-7 rounded-xl border border-tobacco/20 bg-parchment/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40">
            Final prompt
            <span className="font-normal text-ink/60">
              {finalPrompt
                ? finalStale
                  ? "Out of date; it will be rewritten when you generate"
                  : "Ready; you can edit it"
                : "Written automatically when you generate"}
            </span>
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-ink/70">
              Your prompt with the product details and brand style added. This
              is what is sent to the model.
            </p>
            <textarea
              rows={6}
              value={finalPrompt}
              maxLength={4000}
              onChange={(event) => {
                setFinalPrompt(event.target.value);
                // An edit makes it the user's own, so it is no longer stale.
                setFinalFor(signature);
              }}
              placeholder="Not written yet."
              aria-label="Final prompt"
              className={`mt-3 resize-y text-sm leading-relaxed ${field}`}
            />
            <button
              type="button"
              disabled={enriching || !prompt.trim()}
              onClick={() => void enrich()}
              className="mt-3 rounded-xl border border-ink/25 bg-offwhite px-4 py-2 text-sm font-bold text-ink transition hover:border-terracotta hover:text-terracotta focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enriching
                ? "Writing…"
                : finalPrompt
                  ? "Rewrite from my prompt"
                  : "Write it now"}
            </button>
          </div>
        </details>

        {formError && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink"
          >
            <span className="font-bold text-terracotta">Something went wrong.</span>{" "}
            {formError}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-ink/60">
            {!hasSubject
              ? "Choose a product or add a reference image to begin."
              : !prompt.trim()
                ? "Describe the ad you want."
                : video
                  ? "Videos take a few minutes and cost much more than images."
                  : ""}
          </p>
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => void generate()}
            className="rounded-xl bg-terracotta px-6 py-3 text-base font-bold text-white transition hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-offwhite disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enriching
              ? "Writing prompt…"
              : submitting
                ? "Starting…"
                : video
                  ? "Generate video"
                  : variations > 1
                    ? `Generate ${variations} images`
                    : "Generate image"}
          </button>
        </div>
      </div>

      {sessionEntries.length > 0 && (
        <section aria-label="Results">
          <h2 className="font-serif text-2xl font-bold text-ink">Results</h2>
          <p className="mt-1 text-sm text-ink/70">
            What you have made in this visit. Everything is also saved to the
            library below.
          </p>
          <div className="mt-4">{grid(sessionEntries)}</div>
        </section>
      )}

      <section aria-label="Library">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">Library</h2>
            <p className="mt-1 text-sm text-ink/70">
              Every generation, with its prompt, settings, product and date.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Filter by product"
              value={filterProduct}
              onChange={(event) => setFilterProduct(event.target.value)}
              className={smallField}
            >
              <option value="all">All products</option>
              {PRODUCTS.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by type"
              value={filterType}
              onChange={(event) => setFilterType(event.target.value as "all" | AdType)}
              className={smallField}
            >
              <option value="all">Images and videos</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
          </div>
        </div>

        {libraryError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink"
          >
            <span className="font-bold text-terracotta">Something went wrong.</span>{" "}
            {libraryError}{" "}
            <button
              type="button"
              onClick={() => void loadLibrary()}
              className="text-terracotta underline underline-offset-2"
            >
              Try again
            </button>
          </p>
        )}

        <div className="mt-4">
          {library === null && !libraryError ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  role="status"
                  aria-label="Loading library"
                  className="shimmer aspect-square animate-shimmer rounded-xl border border-tobacco/15"
                />
              ))}
            </div>
          ) : libraryEntries.length > 0 ? (
            grid(libraryEntries)
          ) : (
            library !== null && (
              <p className="rounded-xl border border-dashed border-tobacco/30 px-4 py-10 text-center text-sm text-ink/60">
                {library.length === 0
                  ? "Nothing here yet. The ads you generate are saved here."
                  : "Nothing in the library matches these filters."}
              </p>
            )
          )}
        </div>
      </section>

      <footer className="mt-auto pt-6 text-center text-xs text-ink/50">
        Images and videos are AI-generated. Check them against the real product
        and the brand guide before publishing.
      </footer>
    </main>
  );
}
