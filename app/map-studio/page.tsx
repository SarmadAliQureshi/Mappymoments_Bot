"use client";

import { useEffect, useRef, useState } from "react";
import ImageDisplay, { type MomentItem } from "@/components/ImageDisplay";
import PromptInput, { type PromptValues } from "@/components/PromptInput";
import type { AspectRatio, GenerateResult } from "@/lib/brand";
import { fitPlaces, type Place } from "@/lib/mapRender";
import {
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  getProduct,
  getSize,
} from "@/lib/products";
import { loadState, saveState } from "@/lib/persist";
import { DEFAULT_TILE_STYLE_ID } from "@/lib/tileStyles";

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? fallback);
  return data;
}

function Sprig({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M8 112C40 92 72 60 108 10" />
      <path d="M34 92c-2-14 4-24 16-30 2 14-4 24-16 30Z" />
      <path d="M56 70c-2-14 4-24 16-30 2 14-4 24-16 30Z" />
      <path d="M78 46c-1-12 4-20 14-25 1 12-4 20-14 25Z" />
      <path d="M44 84c12 4 22 2 30-6-12-4-22-2-30 6Z" />
      <path d="M66 60c12 4 22 2 30-6-12-4-22-2-30 6Z" />
    </svg>
  );
}

const STORAGE_KEY = "map-studio";
// Generated photos are large, so only the most recent moments are saved.
const MAX_SAVED = 12;

// Kept outside the component so the work survives switching to another tab
// of the site and back without waiting for storage.
const saved: {
  values: PromptValues;
  gallery: MomentItem[];
  activeId: number | null;
} = {
  values: {
    design: "urban",
    place: "",
    place2: "",
    title: "",
    photoUrl: null,
    productId: DEFAULT_PRODUCT_ID,
    sizeId: "16x20",
    finishId: "natural",
    landscape: false,
    prompt: "",
    aspect: "square",
  },
  gallery: [],
  activeId: null,
};

export default function HomePage() {
  const [values, setValues] = useState<PromptValues>(saved.values);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gallery, setGallery] = useState<MomentItem[]>(saved.gallery);
  const [activeId, setActiveId] = useState<number | null>(saved.activeId);
  const [pendingAspect, setPendingAspect] = useState<AspectRatio>("square");
  const outputRef = useRef<HTMLElement>(null);

  // Work is kept in the browser so a reload does not lose it. `restored`
  // stops the empty first render from overwriting what was saved.
  const [restored, setRestored] = useState(saved.gallery.length > 0);
  useEffect(() => {
    if (restored) return;
    let cancelled = false;
    void loadState<typeof saved>(STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored) {
        // An uploaded photo is a temporary link that does not outlive a reload.
        setValues({ ...saved.values, ...stored.values, photoUrl: null });
        setGallery(stored.gallery.map((item) => ({ ...item, photoUrl: null })));
        setActiveId(stored.activeId);
      }
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [restored]);

  useEffect(() => {
    saved.values = values;
    saved.gallery = gallery;
    saved.activeId = activeId;
    if (!restored) return;
    const timer = setTimeout(
      () =>
        void saveState(STORAGE_KEY, {
          values,
          gallery: gallery.slice(0, MAX_SAVED),
          activeId,
        }),
      500,
    );
    return () => clearTimeout(timer);
  }, [values, gallery, activeId, restored]);

  const active = gallery.find((item) => item.id === activeId) ?? null;

  function updateItem(id: number, patch: Partial<MomentItem>) {
    setGallery((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  // variantOf: make another photo of an existing moment, keeping its design,
  // places, product, map style and view.
  async function generate(variantOf?: MomentItem) {
    if (loading) return;

    const product =
      variantOf?.product ?? getProduct(values.productId) ?? PRODUCTS[0];
    const size = variantOf?.size ?? getSize(product, values.sizeId);
    const landscape = variantOf?.landscape ?? values.landscape;
    const finishId = variantOf?.finishId ?? values.finishId;
    const aspect = variantOf?.aspect ?? values.aspect;
    const prompt = variantOf?.originalPrompt ?? values.prompt;

    setLoading(true);
    setError(null);
    setPendingAspect(aspect);
    requestAnimationFrame(() =>
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );

    try {
      const queries =
        values.design === "spanning"
          ? [values.place, values.place2]
          : [values.place];
      const places: Place[] =
        variantOf?.places ??
        (await Promise.all(
          queries.map(async (query) =>
            readJson(
              await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`),
              "We could not look up that place. Please try again.",
            ),
          ),
        ));
      const fitted = fitPlaces(places);

      let scene: GenerateResult | null = null;
      if (product.physical) {
        scene = await readJson(
          await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              aspect,
              product: product.id,
              size: size.id,
              landscape,
              finish: finishId,
              variant: !!variantOf,
            }),
          }),
          "We could not create that image. Please try again.",
        );
      }

      const item: MomentItem = {
        id: Date.now(),
        product,
        size,
        landscape,
        finishId,
        design: variantOf?.design ?? values.design,
        places,
        center: variantOf?.center ?? fitted.center,
        title: variantOf?.title ?? values.title,
        photoUrl: variantOf?.photoUrl ?? values.photoUrl,
        colors: variantOf?.colors ?? {},
        sceneUrl: scene?.imageUrl ?? null,
        originalPrompt: scene?.originalPrompt ?? "",
        enhancedPrompt: scene?.enhancedPrompt ?? "",
        aspect,
        styleId: variantOf?.styleId ?? DEFAULT_TILE_STYLE_ID,
        zoom: variantOf?.zoom ?? fitted.zoom,
      };
      setGallery((previous) => [item, ...previous]);
      setActiveId(item.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We could not create that image. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <Sprig className="pointer-events-none absolute -right-6 -top-6 h-44 w-44 rotate-180 text-tobacco/20" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
        <header className="text-center">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Mappy Moments
          </h1>
          <p className="mt-3 text-xs uppercase tracking-[0.25em] text-ink/70 sm:text-sm">
            Personalized Keepsakes &amp; Timeless Memories
          </p>
          <div className="mx-auto mt-5 h-px w-16 bg-brass" />
        </header>

        <PromptInput
          values={values}
          onChange={(patch) => setValues((previous) => ({ ...previous, ...patch }))}
          onSubmit={() => generate()}
          loading={loading}
        />

        <section
          ref={outputRef}
          aria-label="Generated image"
          className="scroll-mt-16"
        >
          {error && !loading && (
            <div
              role="alert"
              className="mx-auto mb-6 max-w-2xl rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink"
            >
              <span className="font-bold text-terracotta">
                Something went wrong.
              </span>{" "}
              {error}
            </div>
          )}

          <ImageDisplay
            key={active?.id ?? "empty"}
            item={active}
            loading={loading}
            loadingAspect={pendingAspect}
            onChange={(patch) => {
              if (active) updateItem(active.id, patch);
            }}
            onGenerateVariant={() => {
              if (active) generate(active);
            }}
          />

          {!active && !loading && !error && (
            <p className="text-center text-sm text-ink/60">
              Your image will appear here, with the map styles and colour options
              below it.
            </p>
          )}
        </section>

        {gallery.length > 1 && (
          <section aria-label="Earlier images">
            <h2 className="font-serif text-lg font-bold text-ink">
              This session
            </h2>
            <ul className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
              {gallery.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(item.id);
                    }}
                    aria-label={`Show ${item.product.name} of ${item.places[0].name}`}
                    aria-current={item.id === activeId}
                    className={`block aspect-square w-full overflow-hidden rounded-xl border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${
                      item.id === activeId
                        ? "border-terracotta"
                        : "border-transparent hover:border-tobacco/40"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-auto pt-6 text-center text-xs text-ink/50">
          Images are AI-generated concepts. Review against the brand guide
          before publishing.
        </footer>
      </main>
    </div>
  );
}
