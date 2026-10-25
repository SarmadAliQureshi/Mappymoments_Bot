"use client";

import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/PromptInput";
import ThemeMap, { type MapTarget } from "@/components/themes/ThemeMap";
import { loadState, saveState } from "@/lib/persist";
import {
  BASE_COLORS,
  BASE_STYLE,
  applyMapping,
  slugify,
  type ColorMapping,
} from "@/lib/themes/theme";
import { parseColor, toHex } from "@/lib/themes/colors";

const STORAGE_KEY = "color-themes";

interface Theme {
  /** The request the theme was first made from. */
  request: string;
  name: string;
  mapping: ColorMapping;
  /** Follow-up changes applied since, oldest first. */
  refinements: string[];
}

// Kept outside the component so the theme survives switching tabs.
const saved: { theme: Theme | null } = { theme: null };

const primaryButton =
  "rounded-xl bg-terracotta px-5 py-3 text-base font-bold text-white transition hover:bg-terracotta-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 focus-visible:ring-offset-offwhite disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "rounded-xl border border-ink/25 bg-offwhite px-4 py-2.5 text-sm font-bold text-ink transition hover:border-terracotta hover:text-terracotta focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-ink/25 disabled:hover:text-ink";
const label = "text-xs font-bold uppercase tracking-widest text-ink/60";

const swatchHex = (color: string) => toHex(parseColor(color)!);

export default function ColorThemesPage() {
  const [theme, setTheme] = useState<Theme | null>(saved.theme);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "generate" | "refine" | "regenerate">(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"generated" | "base">("generated");
  const [copied, setCopied] = useState(false);
  const [restored, setRestored] = useState(saved.theme !== null);
  const [place, setPlace] = useState("");
  const [searching, setSearching] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [target, setTarget] = useState<MapTarget | null>(null);

  // Moves the preview to a searched place, using the same place lookup as
  // Map Studio.
  async function searchPlace() {
    const query = place.trim();
    if (!query || searching) return;
    setSearching(true);
    setPlaceError(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.lat !== "number") {
        throw new Error(data?.error ?? "That place could not be found.");
      }
      setTarget({ id: Date.now(), lat: data.lat, lng: data.lng, zoom: 12 });
      setFound([data.name, data.country].filter(Boolean).join(", "));
    } catch (caught) {
      setPlaceError(caught instanceof Error ? caught.message : "That place could not be found.");
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (restored) return;
    let cancelled = false;
    void loadState<Theme>(STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored?.mapping) setTheme(stored);
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [restored]);

  useEffect(() => {
    saved.theme = theme;
    if (restored) void saveState(STORAGE_KEY, theme);
  }, [theme, restored]);

  // The full style is rebuilt from the base in code; only colours can differ.
  const generatedStyle = useMemo(
    () => (theme ? applyMapping(theme.mapping) : null),
    [theme],
  );
  const shownStyle = view === "generated" && generatedStyle ? generatedStyle : BASE_STYLE;
  const styleJson = useMemo(
    () => (generatedStyle ? JSON.stringify(generatedStyle, null, 2) : ""),
    [generatedStyle],
  );
  const fileName = theme ? `${slugify(theme.name)}-map-style.json` : "";

  async function call(
    kind: "generate" | "refine" | "regenerate",
    payload: Record<string, unknown>,
  ): Promise<{ name: string; mapping: ColorMapping } | null> {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch("/api/color-themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.mapping) {
        throw new Error(data?.error ?? "The theme could not be generated. Please try again.");
      }
      setView("generated");
      return data;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The theme could not be generated.",
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const input = text.trim();
    if (!input || busy) return;
    if (theme) {
      // With a theme on screen, new text refines it instead of starting over.
      const data = await call("refine", {
        prompt: theme.request,
        refine: input,
        current: theme.mapping,
      });
      if (data) {
        setTheme({
          ...theme,
          mapping: data.mapping,
          refinements: [...theme.refinements, input],
        });
        setText("");
      }
    } else {
      const data = await call("generate", { prompt: input });
      if (data) {
        setTheme({ request: input, name: data.name, mapping: data.mapping, refinements: [] });
        setText("");
      }
    }
  }

  async function regenerate() {
    if (!theme || busy) return;
    const data = await call("regenerate", {
      prompt: theme.request,
      current: theme.mapping,
      variation: true,
    });
    if (data) {
      setTheme({ request: theme.request, name: data.name, mapping: data.mapping, refinements: [] });
    }
  }

  function download() {
    if (!styleJson) return;
    const url = URL.createObjectURL(new Blob([styleJson], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    if (!styleJson) return;
    try {
      await navigator.clipboard.writeText(styleJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The JSON could not be copied. Use Download JSON instead.");
    }
  }

  const changed = theme
    ? BASE_COLORS.filter(
        (entry) => (theme.mapping[entry.color] ?? entry.color) !== entry.color,
      ).length
    : 0;
  // A theme saved before the base style was replaced has no entry for the
  // base's new colours, so those would stay as they are in the base.
  const unthemed = theme
    ? BASE_COLORS.filter((entry) => !(entry.color in theme.mapping)).length
    : 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="text-center">
        <h1 className="font-serif text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          AI Map Style
        </h1>
        <p className="mt-3 text-xs uppercase tracking-[0.25em] text-ink/70 sm:text-sm">
          Describe a palette, get a map style
        </p>
        <div className="mx-auto mt-5 h-px w-16 bg-brass" />
      </header>

      <form
        className="rounded-xl border border-tobacco/20 bg-offwhite p-5 shadow-soft sm:p-7"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="theme-prompt" className={label}>
          {theme ? "Refine this theme" : "Describe the colours"}
        </label>
        <p className="mt-1 text-sm text-ink/70">
          {theme
            ? `Based on “${theme.request}”. Type a change and it is applied to the current result.`
            : "The Mappy Moments base style is recoloured to match. Only colours change; the map's layers, widths and zoom behaviour stay exactly as they are."}
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            id="theme-prompt"
            type="text"
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              theme
                ? "e.g. make the water darker, less saturated roads"
                : "e.g. give me a green and red map"
            }
            className="min-w-0 flex-1 rounded-xl border border-tobacco/25 bg-parchment/50 px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25"
          />
          <button type="submit" disabled={!!busy || !text.trim()} className={primaryButton}>
            {busy === "generate"
              ? "Generating…"
              : busy === "refine"
                ? "Applying…"
                : theme
                  ? "Apply change"
                  : "Generate"}
          </button>
        </div>

        {theme && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void regenerate()}
              className={secondaryButton}
            >
              {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setTheme(null);
                setView("generated");
                setError(null);
              }}
              className={secondaryButton}
            >
              Start a new theme
            </button>
            {theme.refinements.length > 0 && (
              <p className="text-sm text-ink/60">
                Changes so far: {theme.refinements.join("; ")}
              </p>
            )}
          </div>
        )}

        {unthemed > 0 && (
          <p className="mt-4 rounded-xl border border-brass/60 bg-parchment px-4 py-3 text-sm text-ink">
            The base style has changed since this theme was made, so {unthemed}{" "}
            of its colours {unthemed === 1 ? "is" : "are"} not themed yet.
            Press Regenerate to redo the theme on the new base.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-terracotta/40 bg-offwhite px-4 py-3 text-sm text-ink"
          >
            <span className="font-bold text-terracotta">Something went wrong.</span>{" "}
            {error}
          </p>
        )}
      </form>

      <section aria-label="Map preview">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">
              {view === "generated" && theme ? theme.name : "Base style"}
            </h2>
            <p className="text-sm text-ink/70">
              Drag to move and zoom in or out to check every level.
            </p>
          </div>
          <Segmented
            name="Style shown"
            options={[
              { value: "generated", label: theme ? "Generated" : "Generated (none yet)" },
              { value: "base", label: "Base" },
            ]}
            value={theme ? view : "base"}
            onChange={(next) => {
              if (theme) setView(next);
            }}
          />
        </div>
        <form
          role="search"
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void searchPlace();
          }}
        >
          <input
            type="search"
            value={place}
            maxLength={200}
            onChange={(event) => setPlace(event.target.value)}
            placeholder="Search a place, e.g. Lahore or Lake Como"
            aria-label="Search a place to show on the map"
            className="min-w-0 flex-1 rounded-xl border border-tobacco/25 bg-offwhite px-4 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25"
          />
          <button
            type="submit"
            disabled={searching || !place.trim()}
            className={secondaryButton}
          >
            {searching ? "Searching…" : "Go"}
          </button>
          {(placeError || found) && (
            <p
              role={placeError ? "alert" : "status"}
              className={`w-full text-sm ${placeError ? "text-terracotta" : "text-ink/70"}`}
            >
              {placeError ?? `Showing ${found}.`}
            </p>
          )}
        </form>
        <div className="relative">
          <ThemeMap style={shownStyle} target={target} />
          {busy && (
            <div
              role="status"
              aria-live="polite"
              className="shimmer absolute inset-x-0 bottom-0 animate-shimmer rounded-b-xl px-4 py-3 text-center font-serif text-base text-ink"
            >
              Mixing your colours…
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!generatedStyle}
            onClick={download}
            className={primaryButton.replace("px-5 py-3 text-base", "px-4 py-2.5 text-sm")}
          >
            Download JSON
          </button>
          <button
            type="button"
            disabled={!generatedStyle}
            onClick={() => void copy()}
            className={secondaryButton}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
          <p className="text-sm text-ink/60">
            {theme
              ? `${fileName} · the complete style, ${BASE_STYLE.layers.length} layers, ${changed} of ${BASE_COLORS.length} colours changed`
              : "Generate a theme to enable these."}
          </p>
        </div>
      </section>

      <section aria-label="Palette">
        <h2 className="font-serif text-2xl font-bold text-ink">Palette</h2>
        <p className="mt-1 text-sm text-ink/70">
          {theme
            ? "Each base colour and what it became. Colours used only by hidden layers are listed last."
            : "The colours of the base style and what each one paints. A generated theme replaces them one for one."}
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BASE_COLORS.map((entry) => {
            const next = theme?.mapping[entry.color] ?? entry.color;
            const hidden = entry.visibleLayers.length === 0;
            return (
              <li
                key={entry.color}
                className={`flex items-center gap-3 rounded-xl border border-tobacco/20 bg-offwhite p-2.5 ${
                  hidden ? "opacity-60" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="h-10 w-10 shrink-0 rounded-lg border border-tobacco/25"
                  style={{ backgroundColor: swatchHex(entry.color) }}
                />
                {theme && (
                  <>
                    <span aria-hidden className="text-ink/40">
                      →
                    </span>
                    <span
                      aria-hidden
                      className="h-10 w-10 shrink-0 rounded-lg border border-tobacco/25"
                      style={{ backgroundColor: swatchHex(next) }}
                    />
                  </>
                )}
                <span className="min-w-0 text-xs leading-snug text-ink/80">
                  <span className="block truncate font-bold text-ink">
                    {entry.roles.slice(0, 3).join(", ")}
                    {hidden ? " (hidden)" : ""}
                  </span>
                  <span className="block truncate font-mono">
                    {theme ? `${entry.color} → ${next}` : entry.color}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
