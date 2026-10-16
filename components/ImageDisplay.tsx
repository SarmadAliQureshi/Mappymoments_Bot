"use client";

import { useEffect, useRef, useState } from "react";
import type { AspectRatio } from "@/lib/brand";
import {
  wrapVisible,
  compositeMap,
  findPrintArea,
  printAreaRatio,
  type PrintArea,
} from "@/lib/composite";
import type { ColorGroup } from "@/lib/glRender";
import {
  DESIGNS,
  MAX_ZOOM,
  MIN_ZOOM,
  fitPlaces,
  formatCoordinates,
  panCenter,
  renderMapArtwork,
  tileAt,
  type Coordinates,
  type DesignId,
  type MapSpec,
  type Place,
} from "@/lib/mapRender";
import {
  formatPrice,
  printDimensions,
  type Product,
  type ProductSize,
} from "@/lib/products";
import { TILE_STYLES, getTileStyle, tileUrl } from "@/lib/tileStyles";

const ASPECT_CLASS: Record<AspectRatio, string> = {
  square: "aspect-square",
  landscape: "aspect-[3/2]",
  portrait: "aspect-[2/3]",
};

// Longest side of the map artwork canvas, in pixels.
const MAP_PIXELS = 1400;

export interface MomentItem {
  id: number;
  product: Product;
  size: ProductSize;
  landscape: boolean;
  finishId: string;
  design: DesignId;
  places: Place[];
  /** Middle of the map; changes when the map is dragged. */
  center: Coordinates;
  title: string;
  photoUrl: string | null;
  /** Colour overrides for Mapbox styles, keyed by colour group. */
  colors: Record<string, string>;
  /** AI product photo with a magenta print area; null for a digital download. */
  sceneUrl: string | null;
  originalPrompt: string;
  enhancedPrompt: string;
  aspect: AspectRatio;
  styleId: string;
  zoom: number;
  thumbUrl?: string;
}

interface SceneData {
  pixels: ImageData;
  area: PrintArea | null;
}

interface ImageDisplayProps {
  item: MomentItem | null;
  loading: boolean;
  loadingAspect: AspectRatio;
  onChange: (patch: Partial<MomentItem>) => void;
  onGenerateVariant: () => void;
}

function Accordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-tobacco/20 bg-offwhite">
      <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40">
        {title}
        <span
          aria-hidden
          className="text-terracotta transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <p className="whitespace-pre-wrap px-4 pb-4 text-sm leading-relaxed text-ink/80">
        {children}
      </p>
    </details>
  );
}

export function LoadingFrame({ aspect }: { aspect: AspectRatio }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`shimmer flex w-full animate-shimmer items-center justify-center rounded-xl border border-tobacco/15 shadow-soft ${ASPECT_CLASS[aspect]}`}
    >
      <div className="px-6 text-center">
        <p className="font-serif text-xl text-ink">
          Crafting your brand moment…
        </p>
        <p className="mt-2 text-sm text-ink/60">
          This usually takes under a minute.
        </p>
      </div>
    </div>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The photo could not be read."));
    image.src = url;
  });
}

function loadScene(url: string): Promise<SceneData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("This browser cannot draw the photo."));
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ pixels, area: findPrintArea(pixels) });
    };
    image.onerror = () => reject(new Error("The product photo could not be read."));
    image.src = url;
  });
}

export default function ImageDisplay({
  item,
  loading,
  loadingAspect,
  onChange,
  onGenerateVariant,
}: ImageDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<SceneData | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [groups, setGroups] = useState<ColorGroup[]>([]);
  const [colorPrompt, setColorPrompt] = useState("");
  const [colorBusy, setColorBusy] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  // What the last render drew, so a drag can be turned into a map movement.
  const viewRef = useRef<{ spec: MapSpec; mapPerCanvas: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const photoUrl = item?.photoUrl ?? null;
  useEffect(() => {
    setPhoto(null);
    if (!photoUrl) return;
    let cancelled = false;
    loadImage(photoUrl)
      .then((image) => {
        if (!cancelled) setPhoto(image);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  const sceneUrl = item?.sceneUrl ?? null;
  useEffect(() => {
    setScene(null);
    if (!sceneUrl) return;
    let cancelled = false;
    loadScene(sceneUrl)
      .then((data) => {
        if (!cancelled) setScene(data);
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sceneUrl]);

  // Redraw whenever the style or zoom changes. No API is called here: only
  // map tiles are fetched, and the browser caches those.
  const itemId = item?.id;
  const styleId = item?.styleId;
  const zoom = item?.zoom;
  const centerLat = item?.center.lat;
  const centerLng = item?.center.lng;
  const colorKey = JSON.stringify(item?.colors ?? {});
  useEffect(() => {
    if (!item || loading) return;
    if (item.sceneUrl && !scene) return;
    if (item.photoUrl && !photo) return;
    let cancelled = false;

    const print = printDimensions(item.product, item.size, item.landscape);
    // A flat print takes the shape the photo actually gave it, so the map is
    // never stretched; a mug wrap keeps its real proportions.
    const ratio =
      scene?.area && item.product.shape === "flat"
        ? printAreaRatio(scene.area)
        : print.width / print.height;
    const visible = wrapVisible(print.width, print.height);
    const width = Math.round(ratio >= 1 ? MAP_PIXELS : MAP_PIXELS * ratio);
    const height = Math.round(ratio >= 1 ? MAP_PIXELS / ratio : MAP_PIXELS);

    const spec: MapSpec = {
      design: item.design,
      places: item.places,
      center: item.center,
      zoom: item.zoom,
      style: getTileStyle(item.styleId),
      title: item.title,
      photo,
      colors: item.colors,
      width,
      height,
    };

    renderMapArtwork(spec)
      .then(({ canvas: map, groups: styleGroups }) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        setGroups(styleGroups);
        const context = canvas.getContext("2d");
        if (!context) return;

        if (scene) {
          canvas.width = scene.pixels.width;
          canvas.height = scene.pixels.height;
          if (scene.area) {
            const mapPixels = map
              .getContext("2d")!
              .getImageData(0, 0, map.width, map.height);
            context.putImageData(
              compositeMap(
                scene.pixels,
                scene.area,
                mapPixels,
                item.product.shape,
                visible,
              ),
              0,
              0,
            );
          } else {
            context.putImageData(scene.pixels, 0, 0);
          }
        } else {
          canvas.width = map.width;
          canvas.height = map.height;
          context.drawImage(map, 0, 0);
        }
        setMapError(null);

        // Map pixels covered by one pixel of the picture, for dragging.
        let mapPerCanvas = 1;
        if (scene?.area) {
          const span = Math.max(1, scene.area.right - scene.area.left);
          mapPerCanvas =
            (map.width * (item.product.shape === "wrap" ? visible : 1)) / span;
        }
        viewRef.current = { spec, mapPerCanvas };

        // The gallery thumbnail waits until dragging settles.
        if (thumbTimer.current) clearTimeout(thumbTimer.current);
        thumbTimer.current = setTimeout(() => {
          const thumb = document.createElement("canvas");
          const scale = 160 / Math.max(canvas.width, canvas.height);
          thumb.width = Math.round(canvas.width * scale);
          thumb.height = Math.round(canvas.height * scale);
          thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
          onChange({ thumbUrl: thumb.toDataURL("image/jpeg", 0.7) });
        }, 400);
      })
      .catch((error: Error) => {
        if (!cancelled) setMapError(error.message);
      });

    return () => {
      cancelled = true;
    };
    // onChange is recreated on every parent render and must not retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, styleId, zoom, centerLat, centerLng, colorKey, scene, photo, loading]);

  useEffect(
    () => () => {
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
    },
    [],
  );

  // Asks the language model which colour groups the request refers to.
  async function applyColorPrompt() {
    if (!item || colorBusy || !colorPrompt.trim()) return;
    setColorBusy(true);
    setColorError(null);
    try {
      const response = await fetch("/api/map-colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: colorPrompt,
          // Send the colours as they are now, including earlier changes.
          groups: groups.map((group) => ({
            ...group,
            color: item.colors[group.id] ?? group.color,
          })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.colors) {
        throw new Error(data?.error ?? "The colours could not be changed. Please try again.");
      }
      onChange({ colors: { ...item.colors, ...data.colors } });
      setColorPrompt("");
    } catch (error) {
      setColorError(
        error instanceof Error ? error.message : "The colours could not be changed.",
      );
    } finally {
      setColorBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <LoadingFrame aspect={loadingAspect} />
      </div>
    );
  }

  if (!item) return null;

  async function copyEnhancedPrompt() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.enhancedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadImage() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `mappy-moments-${item?.places[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${item?.product.id}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }, "image/png");
  }

  const canDrag = !item.sceneUrl || !!scene?.area;

  function dragMap(event: React.PointerEvent<HTMLCanvasElement>) {
    const last = dragRef.current;
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (!last || !view || !canvas) return;
    // Screen pixels -> picture pixels -> map artwork pixels.
    const factor =
      (canvas.width / canvas.getBoundingClientRect().width) * view.mapPerCanvas;
    const center = panCenter(
      { ...view.spec, center: item!.center },
      (event.clientX - last.x) * factor,
      (event.clientY - last.y) * factor,
    );
    dragRef.current = { x: event.clientX, y: event.clientY };
    onChange({ center });
  }

  const home = fitPlaces(item.places);
  const moved =
    Math.abs(home.center.lat - item.center.lat) > 1e-6 ||
    Math.abs(home.center.lng - item.center.lng) > 1e-6 ||
    home.zoom !== item.zoom;
  const designName = DESIGNS.find((design) => design.id === item.design)?.name;
  const previewZoom = Math.min(13, Math.max(2, Math.round(item.zoom) - 1));
  const currentStyle = getTileStyle(item.styleId);
  const placeholderMissing = !!scene && !scene.area;
  const secondaryButton =
    "rounded-xl border border-ink/25 bg-offwhite px-4 py-2.5 text-sm font-bold text-ink transition hover:border-terracotta hover:text-terracotta focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40";

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="overflow-hidden rounded-xl border border-tobacco/15 bg-offwhite shadow-soft">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${item.product.name} with a map of ${item.places
            .map((place) => place.name)
            .join(" and ")}`}
          onPointerDown={(event) => {
            if (!canDrag) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={dragMap}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          className={`block h-auto w-full touch-none select-none ${
            canDrag ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="text-sm text-ink/80">
          {item.places.map((place) => (
            <p key={`${place.lat},${place.lng}`}>
              <span className="font-bold text-ink">
                {place.name}
                {place.country ? `, ${place.country}` : ""}
              </span>{" "}
              · {formatCoordinates(place)}
            </p>
          ))}
          <p className="mt-1 text-ink/60">
            {designName} · {item.product.name} {item.size.label}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xs font-bold uppercase tracking-widest text-ink/60">
            Price
          </span>
          <span className="font-serif text-2xl font-bold text-ink">
            {formatPrice(item.size.priceUsd)}
          </span>
        </p>
      </div>

      {placeholderMissing && (
        <p role="alert" className="mt-3 rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink">
          <span className="font-bold text-terracotta">
            The map could not be placed.
          </span>{" "}
          This photo has no clear print area. Use Generate Variant to get
          another one.
        </p>
      )}
      {mapError && (
        <p role="alert" className="mt-3 rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink">
          <span className="font-bold text-terracotta">Map not updated.</span>{" "}
          {mapError}
        </p>
      )}

      <div className="mt-5">
        {canDrag && (
          <p className="mb-4 text-sm text-ink/70">
            Drag the map to move it, and use the zoom slider to get closer.
          </p>
        )}
        <div className="flex items-center justify-end gap-4">
          {moved && (
            <button
              type="button"
              onClick={() => onChange({ center: home.center, zoom: home.zoom })}
              className="text-xs text-terracotta underline-offset-2 hover:underline"
            >
              Recentre
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-ink/70">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.5}
              value={item.zoom}
              onChange={(event) => onChange({ zoom: Number(event.target.value) })}
              className="w-32 accent-terracotta"
            />
          </label>
        </div>
        <details
          open
          className="group mt-3 rounded-xl border border-tobacco/20 bg-offwhite"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40">
            <span className="text-xs font-bold uppercase tracking-widest text-ink/60">
              Map style
            </span>
            <span className="ml-auto text-sm font-bold text-ink">
              {currentStyle.name}
            </span>
            <span
              aria-hidden
              className="text-terracotta transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div
            role="radiogroup"
            aria-label="Map style"
            className="grid grid-cols-5 gap-2 px-4 pb-4 sm:grid-cols-8"
          >
          {TILE_STYLES.map((style) => {
            const selected = style.id === item.styleId;
            const z = Math.min(previewZoom, style.maxZoom ?? 19);
            const tile = tileAt(item.center, z);
            return (
              <button
                key={style.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ styleId: style.id, colors: {} })}
                className="group text-left focus:outline-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tileUrl(style, z, tile.x, tile.y)}
                  alt=""
                  loading="lazy"
                  className={`aspect-square w-full rounded-lg border-2 bg-parchment object-cover transition group-focus-visible:ring-2 group-focus-visible:ring-terracotta/40 ${
                    selected
                      ? "border-terracotta"
                      : "border-tobacco/20 group-hover:border-tobacco/50"
                  }`}
                />
                <span
                  className={`mt-1 block text-[11px] leading-tight ${
                    selected ? "font-bold text-terracotta" : "text-ink/80"
                  }`}
                >
                  {style.name}
                </span>
              </button>
            );
          })}
          </div>
          {!currentStyle.gl && TILE_STYLES.some((style) => style.gl) && (
            <p className="px-4 pb-4 text-sm text-ink/70">
              To change the map's colours, pick one of the first styles in
              this list (the Mapbox styles, such as Mappy Studio).
            </p>
          )}
        </details>
      </div>

      {groups.length > 0 && (
        <div className="mt-5 rounded-xl border border-tobacco/20 bg-offwhite p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-bold uppercase tracking-widest text-ink/60">
              Map colours
            </p>
            {Object.keys(item.colors).length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ colors: {} })}
                className="text-xs text-terracotta underline-offset-2 hover:underline"
              >
                Reset colours
              </button>
            )}
          </div>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void applyColorPrompt();
            }}
          >
            <input
              type="text"
              value={colorPrompt}
              maxLength={500}
              onChange={(event) => setColorPrompt(event.target.value)}
              placeholder="Make the river light blue and the streets navy"
              aria-label="Describe the colours you want"
              className="min-w-0 flex-1 rounded-xl border border-tobacco/25 bg-parchment/50 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25"
            />
            <button
              type="submit"
              disabled={colorBusy || !colorPrompt.trim()}
              className="rounded-xl bg-terracotta px-4 py-2 text-sm font-bold text-white transition hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-offwhite disabled:cursor-not-allowed disabled:opacity-50"
            >
              {colorBusy ? "Applying…" : "Apply"}
            </button>
          </form>
          {colorError && (
            <p role="alert" className="mt-2 text-sm text-terracotta">
              {colorError}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {groups.map((group) => (
              <label
                key={group.id}
                className="flex items-center gap-3 text-sm text-ink"
              >
                <input
                  type="color"
                  value={item.colors[group.id] ?? group.color}
                  onChange={(event) =>
                    onChange({
                      colors: { ...item.colors, [group.id]: event.target.value },
                    })
                  }
                  className="h-9 w-12 cursor-pointer rounded-lg border border-tobacco/25 bg-parchment p-0.5"
                />
                {group.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={downloadImage}
          className="rounded-xl bg-terracotta px-4 py-2.5 text-sm font-bold text-white transition hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-parchment"
        >
          Download Image
        </button>
        {item.sceneUrl && (
          <>
            <button
              type="button"
              onClick={copyEnhancedPrompt}
              className={secondaryButton}
            >
              {copied ? "Copied" : "Copy Enhanced Prompt"}
            </button>
            <button
              type="button"
              onClick={onGenerateVariant}
              className={secondaryButton}
            >
              Generate Variant
            </button>
          </>
        )}
      </div>

      {item.sceneUrl && (
        <div className="mt-5 space-y-3">
          <Accordion title="Your scene prompt">{item.originalPrompt}</Accordion>
          <Accordion title="Brand-enhanced prompt">
            {item.enhancedPrompt}
          </Accordion>
        </div>
      )}
    </div>
  );
}
