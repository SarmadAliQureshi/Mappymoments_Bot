"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAPBOX_TOKEN } from "@/lib/tileStyles";

export interface PlaceResult {
  name: string;
  lat: number;
  lng: number;
  /** [west, south, east, north], when the place has an extent. */
  bbox?: [number, number, number, number];
}

interface Suggestion extends PlaceResult {
  id: string;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
}

const field =
  "w-full rounded-xl border border-tobacco/25 bg-offwhite px-4 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25";

/** Place search with suggestions as you type, from Mapbox's geocoder. */
export default function PlaceSearch({
  onSelect,
}: {
  onSelect: (place: PlaceResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();
  const skipNext = useRef(false);

  // Ask for suggestions a moment after typing stops.
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const text = query.trim();
    if (text.length < 2 || !MAPBOX_TOKEN) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json`,
        );
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("limit", "6");
        url.searchParams.set("language", "en");
        url.searchParams.set(
          "types",
          "country,region,district,place,locality,neighborhood,poi,address",
        );
        url.searchParams.set("access_token", MAPBOX_TOKEN);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const features = ((await response.json()).features ?? []) as MapboxFeature[];
        setSuggestions(
          features.map((feature) => ({
            id: feature.id,
            name: feature.place_name,
            lng: feature.center[0],
            lat: feature.center[1],
            bbox: feature.bbox,
          })),
        );
        setActive(-1);
        setOpen(true);
        setMessage(features.length ? null : "No places match that.");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setMessage("Place suggestions are unavailable right now.");
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(suggestion: Suggestion) {
    skipNext.current = true;
    setQuery(suggestion.name);
    setOpen(false);
    setSuggestions([]);
    setMessage(null);
    onSelect(suggestion);
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative">
      <input
        type="search"
        role="combobox"
        aria-label="Search a place to show on the map"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={query}
        maxLength={200}
        placeholder="Search a place, e.g. Lahore or Lake Como"
        onChange={(event) => {
          setQuery(event.target.value);
          setMessage(null);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(suggestions.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const pick = suggestions[active >= 0 ? active : 0];
            if (pick) choose(pick);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={field}
      />
      {loading && (
        <span className="pointer-events-none absolute right-10 top-2.5 text-xs text-ink/50">
          Searching…
        </span>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Place suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-tobacco/25 bg-offwhite py-1 shadow-soft"
        >
          {suggestions.map((suggestion, index) => {
            const [first, ...rest] = suggestion.name.split(", ");
            return (
              <li
                key={suggestion.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(suggestion)}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-4 py-2 text-sm ${
                  index === active ? "bg-parchment text-terracotta" : "text-ink"
                }`}
              >
                <span className="font-bold">{first}</span>
                {rest.length > 0 && (
                  <span className="text-ink/60">, {rest.join(", ")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message && (
        <p role="status" className="mt-1 text-sm text-ink/60">
          {message}
        </p>
      )}
    </div>
  );
}
