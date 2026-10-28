"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MapStyle } from "@/lib/themes/theme";
import { MAPBOX_TOKEN } from "@/lib/tileStyles";

// Islamabad: the street grid, Rawal Lake, parks and the Margalla Hills are
// all in view, so every kind of feature can be checked.
const START = { center: [73.085, 33.715] as [number, number], zoom: 11.2 };

/** A place to move the map to; a new `id` moves it even to the same place. */
export interface MapTarget {
  id: number;
  lat: number;
  lng: number;
  zoom: number;
  /** [west, south, east, north]: when given, the map fits this area. */
  bbox?: [number, number, number, number];
}

interface ThemeMapProps {
  style: MapStyle;
  target?: MapTarget | null;
  /** SVG textures the style refers to by name, drawn into the map. */
  images?: Record<string, string>;
}

// Sprite images are drawn at twice their size, as Mapbox does for SVGs, so a
// texture appears at its nominal size on screen.
const PIXEL_RATIO = 2;

function rasterise(svg: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * PIXEL_RATIO));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * PIXEL_RATIO));
      const context = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!context) return reject(new Error("This browser cannot draw the texture."));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("A texture SVG could not be drawn."));
    };
    image.src = url;
  });
}

/** An interactive Mapbox GL map that redraws whenever `style` changes. */
export default function ThemeMap({ style, target, images }: ThemeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const styleRef = useRef(style);
  // Applied once the map exists if a search finishes before it has loaded.
  const targetRef = useRef(target);
  const [zoom, setZoom] = useState(START.zoom);
  const [error, setError] = useState<string | null>(null);
  // Drawn textures by name, and the SVG each was drawn from.
  const rasters = useRef(new Map<string, { svg: string; data: ImageData }>());
  const readyRef = useRef<Promise<MapboxMap> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapboxMap | null = null;
    let resolveReady: (map: MapboxMap) => void = () => undefined;
    readyRef.current = new Promise((resolve) => {
      resolveReady = resolve;
    });

    void import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: styleRef.current as never,
        ...(targetRef.current
          ? {
              center: [targetRef.current.lng, targetRef.current.lat] as [number, number],
              zoom: targetRef.current.zoom,
            }
          : START),
        projection: "mercator",
        attributionControl: true,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
      // A style reload drops added images; put the textures straight back.
      map.on("styleimagemissing", (event: { id: string }) => {
        const raster = rasters.current.get(event.id);
        if (raster && !map!.hasImage(event.id)) {
          map!.addImage(event.id, raster.data, { pixelRatio: PIXEL_RATIO });
        }
      });
      map.on("zoom", () => setZoom(map!.getZoom()));
      map.on("error", (event) => {
        const message = event.error?.message ?? "";
        // Missing sprite images are a quirk of the style, not a failure.
        if (message && !/image|sprite/i.test(message)) setError(message);
      });
      mapRef.current = map;
      resolveReady(map);
    });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    targetRef.current = target;
    if (!target) return;
    if (target.bbox) {
      mapRef.current?.fitBounds(target.bbox, { padding: 40, maxZoom: 15, duration: 1800 });
      return;
    }
    mapRef.current?.flyTo({
      center: [target.lng, target.lat],
      zoom: target.zoom,
      duration: 1800,
      essential: true,
    });
  }, [target]);

  useEffect(() => {
    styleRef.current = style;
    let cancelled = false;
    void (async () => {
      try {
        // Textures are drawn and added before the style that uses them, so
        // the map never shows a gap where a texture should be.
        for (const [name, svg] of Object.entries(images ?? {})) {
          if (rasters.current.get(name)?.svg === svg) continue;
          rasters.current.set(name, { svg, data: await rasterise(svg) });
        }
        const map = await readyRef.current;
        if (cancelled || !map) return;
        for (const [name, raster] of rasters.current) {
          if (!(name in (images ?? {}))) continue;
          if (map.hasImage(name)) map.removeImage(name);
          map.addImage(name, raster.data, { pixelRatio: PIXEL_RATIO });
        }
        // Only paint properties differ between styles, so the map updates in
        // place and keeps its position.
        map.setStyle(style as never);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "The texture could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [style, images]);

  if (!MAPBOX_TOKEN) {
    return (
      <p className="rounded-xl border border-terracotta/40 bg-offwhite px-4 py-10 text-center text-sm text-ink">
        The preview needs a Mapbox token. Add NEXT_PUBLIC_MAPBOX_TOKEN to
        .env.local and restart the server.
      </p>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-tobacco/20 bg-offwhite shadow-soft">
      <div
        ref={containerRef}
        role="application"
        aria-label="Map preview. Drag to move, scroll or use the buttons to zoom."
        className="h-[28rem] w-full sm:h-[34rem]"
      />
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-ink/80 px-2.5 py-1 text-xs text-offwhite">
        Zoom {zoom.toFixed(1)}
      </span>
      {error && (
        <p role="alert" className="absolute inset-x-2 bottom-8 rounded-lg bg-offwhite/95 px-3 py-2 text-xs text-terracotta">
          {error}
        </p>
      )}
    </div>
  );
}
