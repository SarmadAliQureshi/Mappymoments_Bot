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
}

interface ThemeMapProps {
  style: MapStyle;
  target?: MapTarget | null;
}

/** An interactive Mapbox GL map that redraws whenever `style` changes. */
export default function ThemeMap({ style, target }: ThemeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const styleRef = useRef(style);
  // Applied once the map exists if a search finishes before it has loaded.
  const targetRef = useRef(target);
  const [zoom, setZoom] = useState(START.zoom);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapboxMap | null = null;

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
      map.on("zoom", () => setZoom(map!.getZoom()));
      map.on("error", (event) => {
        const message = event.error?.message ?? "";
        // Missing sprite images are a quirk of the style, not a failure.
        if (message && !/image|sprite/i.test(message)) setError(message);
      });
      mapRef.current = map;
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
    mapRef.current?.flyTo({
      center: [target.lng, target.lat],
      zoom: target.zoom,
      duration: 1800,
      essential: true,
    });
  }, [target]);

  useEffect(() => {
    styleRef.current = style;
    // Only paint colours differ between styles, so the map updates in place
    // and keeps its position.
    mapRef.current?.setStyle(style as never);
  }, [style]);

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
