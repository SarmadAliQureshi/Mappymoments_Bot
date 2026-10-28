"use client";

import { strToU8, zipSync } from "fflate";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "@/components/PromptInput";
import PlaceSearch from "@/components/themes/PlaceSearch";
import ThemeMap, { type MapTarget } from "@/components/themes/ThemeMap";
import { loadState, saveState } from "@/lib/persist";
import {
  BASE_COLORS,
  BASE_STYLE,
  applyMapping,
  slugify,
  validateStyle,
  type ColorMapping,
} from "@/lib/themes/theme";
import {
  PATTERN_TARGETS,
  applyPatterns,
  checkSvg,
  getTarget,
  patternName,
  type Pattern,
  type PatternTargetId,
} from "@/lib/themes/patterns";
import { parseColor, toHex } from "@/lib/themes/colors";

const STORAGE_KEY = "color-themes";
const PATTERNS_KEY = "color-themes-patterns";

// Sprite images the base style already uses. They are bundled so an
// uploaded package is complete ("circle" is the one we do not have a file for).
const BASE_SPRITE_IMAGES = [
  "airport", "black-pattern", "city-small", "fdddbrown", "golf", "park-2", "peak",
];

/** The tile size written in an SVG's opening tag. */
function svgSize(svg: string): number {
  const open = svg.slice(0, svg.indexOf(">"));
  return Number(/\swidth\s*=\s*["']?(\d+(?:\.\d+)?)/.exec(open)?.[1] ?? 128);
}

function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface Theme {
  /** The request the theme was first made from. */
  request: string;
  name: string;
  mapping: ColorMapping;
  /** Follow-up changes applied since, oldest first. */
  refinements: string[];
}

// Kept outside the component so the theme survives switching tabs.
const saved: { theme: Theme | null; patterns: Pattern[] } = { theme: null, patterns: [] };

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
  const [found, setFound] = useState<string | null>(null);
  const [target, setTarget] = useState<MapTarget | null>(null);
  const [patterns, setPatterns] = useState<Pattern[]>(saved.patterns);
  const [patternText, setPatternText] = useState("");
  const [patternTarget, setPatternTarget] = useState<"auto" | PatternTargetId>("auto");
  const [patternBusy, setPatternBusy] = useState(false);
  const [patternError, setPatternError] = useState<string | null>(null);

  useEffect(() => {
    if (restored) return;
    let cancelled = false;
    void loadState<Theme>(STORAGE_KEY).then(async (stored) => {
      if (cancelled) return;
      if (stored?.mapping) setTheme(stored);
      const storedPatterns = await loadState<Pattern[]>(PATTERNS_KEY);
      if (cancelled) return;
      if (Array.isArray(storedPatterns)) setPatterns(storedPatterns);
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

  useEffect(() => {
    saved.patterns = patterns;
    if (restored) void saveState(PATTERNS_KEY, patterns);
  }, [patterns, restored]);

  // The full style is rebuilt from the base in code: only colours and the
  // injected textures can differ.
  const generatedStyle = useMemo(
    () =>
      theme || patterns.length
        ? applyPatterns(applyMapping(theme?.mapping ?? {}), patterns)
        : null,
    [theme, patterns],
  );
  const images = useMemo(
    () => Object.fromEntries(patterns.map((pattern) => [pattern.name, pattern.svg])),
    [patterns],
  );
  const problems = useMemo(
    () =>
      generatedStyle
        ? validateStyle(generatedStyle, patterns.map((pattern) => pattern.name))
        : [],
    [generatedStyle, patterns],
  );
  const shownStyle = view === "generated" && generatedStyle ? generatedStyle : BASE_STYLE;
  const styleJson = useMemo(
    () => (generatedStyle ? JSON.stringify(generatedStyle, null, 2) : ""),
    [generatedStyle],
  );
  const styleName = theme?.name ?? (patterns.length ? "textured" : "");
  const fileName = styleName ? `${slugify(styleName)}-map-style.json` : "";

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
    if (!styleJson || problems.length) return;
    saveFile(fileName, styleJson, "application/json");
  }

  /** Adds textures, replacing any earlier one for the same part of the map. */
  function addPatterns(
    added: Omit<Pattern, "name">[],
    titles: string[],
    edits: boolean[] = [],
  ) {
    setPatterns((previous) => {
      const kept = previous.filter(
        (pattern) => !added.some((item) => item.target === pattern.target),
      );
      const taken = new Set(kept.map((pattern) => pattern.name));
      const fresh = added.map((item, index) => {
        // An edited texture keeps its name, so exported styles stay stable.
        const earlier = previous.find((pattern) => pattern.target === item.target);
        if (edits[index] && earlier) {
          taken.add(earlier.name);
          return { ...item, name: earlier.name };
        }
        let name = patternName(`${item.target} ${titles[index] ?? ""}`);
        for (let n = 2; taken.has(name); n++) name = `${name}-${n}`;
        taken.add(name);
        return { ...item, name };
      });
      return [...kept, ...fresh];
    });
    setView("generated");
  }

  async function generatePattern() {
    const input = patternText.trim();
    if (!input || patternBusy) return;
    setPatternBusy(true);
    setPatternError(null);
    try {
      const palette = BASE_COLORS.filter((entry) => entry.visibleLayers.length).map((entry) => ({
        role: entry.roles[0],
        color: theme?.mapping[entry.color] ?? entry.color,
      }));
      const response = await fetch("/api/map-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input,
          target: patternTarget,
          palette,
          current: patterns.map((pattern) => ({ target: pattern.target, svg: pattern.svg })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data?.patterns)) {
        throw new Error(data?.error ?? "The texture could not be made. Please try again.");
      }
      const made = data.patterns as {
        target: PatternTargetId;
        title: string;
        svg: string;
        mode: "edit" | "new";
      }[];
      addPatterns(
        made.map((item) => {
          const earlier = patterns.find((pattern) => pattern.target === item.target);
          return {
            target: item.target,
            svg: item.svg,
            // Edits keep a short history of how the texture came about.
            source:
              item.mode === "edit" && earlier ? `${earlier.source}; then: ${input}` : input,
          };
        }),
        made.map((item) => item.title),
        made.map((item) => item.mode === "edit"),
      );
      setPatternText("");
    } catch (caught) {
      setPatternError(caught instanceof Error ? caught.message : "The texture could not be made.");
    } finally {
      setPatternBusy(false);
    }
  }

  async function uploadPattern(file: File | undefined) {
    if (!file) return;
    setPatternError(null);
    if (patternTarget === "auto") {
      setPatternError("Choose which part of the map the uploaded SVG is for.");
      return;
    }
    const checked = checkSvg(await file.text());
    if ("error" in checked) {
      setPatternError(checked.error);
      return;
    }
    addPatterns(
      [{ target: patternTarget, svg: checked.svg, source: `Uploaded: ${file.name}` }],
      [file.name.replace(/\.svg$/i, "")],
    );
  }

  /** style.json plus every SVG it needs, laid out like a Studio download. */
  async function downloadPackage() {
    if (!styleJson || problems.length) return;
    const files: Record<string, Uint8Array> = { "style.json": strToU8(styleJson) };
    for (const pattern of patterns) {
      files[`sprite_images/${pattern.name}.svg`] = strToU8(pattern.svg);
    }
    for (const name of BASE_SPRITE_IMAGES) {
      const response = await fetch(`/style-sprite/${name}.svg`);
      if (response.ok) files[`sprite_images/${name}.svg`] = strToU8(await response.text());
    }
    files["README.txt"] = strToU8(
      [
        `${styleName} map style`,
        "",
        "style.json is the complete Mapbox style. The SVGs in sprite_images are the images it",
        "uses by name (fill-pattern, background-pattern and icon-image). A style JSON cannot",
        "contain images, so they must be added to the style's sprite in Mapbox Studio:",
        "",
        "1. In Mapbox Studio, create a new style from this package (New style > Upload),",
        "   or upload style.json.",
        "2. Open the style's Images panel and upload every SVG in sprite_images that is not",
        "   already listed. Keep the file names: the style refers to the images by name.",
        "3. Publish the style.",
        "",
        "Textures added by AI Map Style:",
        ...patterns.map((pattern) => `- ${pattern.name}.svg (${getTarget(pattern.target)?.label})`),
        "",
        'The base style also uses an image called "circle" for the large country label; it is',
        "not included here.",
      ].join("\n"),
    );
    saveFile(fileName.replace(/\.json$/, ".zip"), zipSync(files), "application/zip");
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

      <section
        aria-label="Textures"
        className="rounded-xl border border-tobacco/20 bg-offwhite p-5 shadow-soft sm:p-7"
      >
        <h2 className={label}>Textures (SVG patterns)</h2>
        <p className="mt-1 text-sm text-ink/70">
          Describe a texture for an area of the map, for example brown parks
          with small black trees spaced apart. The AI draws it as a repeating
          SVG and puts it on that area. You can also upload an SVG you made.
        </p>
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void generatePattern();
          }}
        >
          <select
            aria-label="Part of the map"
            value={patternTarget}
            onChange={(event) => setPatternTarget(event.target.value as "auto" | PatternTargetId)}
            className="rounded-xl border border-tobacco/25 bg-parchment/50 px-3 py-3 text-sm text-ink focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25"
          >
            <option value="auto">Area: from my description</option>
            {PATTERN_TARGETS.filter((item) => item.layers.length).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={patternText}
            maxLength={500}
            onChange={(event) => setPatternText(event.target.value)}
            placeholder={
              patterns.length
                ? "Describe a change (e.g. make the ship black) or a new texture"
                : "e.g. parks in shades of brown with black tree marks placed at a distance"
            }
            aria-label="Describe the texture"
            className="min-w-0 flex-1 rounded-xl border border-tobacco/25 bg-parchment/50 px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:border-terracotta focus:outline-none focus:ring-2 focus:ring-terracotta/25"
          />
          <button
            type="submit"
            disabled={patternBusy || !patternText.trim()}
            className={primaryButton}
          >
            {patternBusy ? "Drawing…" : "Generate texture"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className={`${secondaryButton} cursor-pointer focus-within:ring-2 focus-within:ring-terracotta/40`}>
            Upload SVG
            <input
              type="file"
              accept=".svg,image/svg+xml"
              className="sr-only"
              onChange={(event) => {
                void uploadPattern(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <span className="text-sm text-ink/60">
            Uploads go to the area chosen on the left.
          </span>
        </div>
        {patternError && (
          <p role="alert" className="mt-3 text-sm text-terracotta">
            {patternError}
          </p>
        )}
        {patterns.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {patterns.map((pattern) => (
              <li
                key={pattern.name}
                className="flex items-center gap-3 rounded-xl border border-tobacco/20 bg-parchment/40 p-3"
              >
                <span
                  aria-hidden
                  className="h-20 w-20 shrink-0 rounded-lg border border-tobacco/25"
                  style={{
                    backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(pattern.svg)}")`,
                    backgroundSize: `${svgSize(pattern.svg) / 2}px`,
                  }}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-bold text-ink">
                    {getTarget(pattern.target)?.label}
                  </span>
                  <span className="block truncate font-mono text-xs text-ink/70">
                    {pattern.name}
                  </span>
                  <span className="block truncate text-xs text-ink/60" title={pattern.source}>
                    {pattern.source}
                  </span>
                  <span className="mt-1 flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => saveFile(`${pattern.name}.svg`, pattern.svg, "image/svg+xml")}
                      className="text-terracotta underline-offset-2 hover:underline"
                    >
                      Download SVG
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPatterns((previous) =>
                          previous.filter((item) => item.name !== pattern.name),
                        )
                      }
                      className="text-ink/60 underline-offset-2 hover:underline"
                    >
                      Remove
                    </button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Map preview">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">
              {view === "generated" && generatedStyle ? styleName : "Base style"}
            </h2>
            <p className="text-sm text-ink/70">
              Drag to move and zoom in or out to check every level.
            </p>
          </div>
          <Segmented
            name="Style shown"
            options={[
              { value: "generated", label: generatedStyle ? "Generated" : "Generated (none yet)" },
              { value: "base", label: "Base" },
            ]}
            value={generatedStyle ? view : "base"}
            onChange={(next) => {
              if (generatedStyle) setView(next);
            }}
          />
        </div>
        <div className="mb-3">
          <PlaceSearch
            onSelect={(place) => {
              // Countries and cities fit their area; points get a city view.
              setTarget({ id: Date.now(), lat: place.lat, lng: place.lng, zoom: 12, bbox: place.bbox });
              setFound(place.name);
            }}
          />
          {found && (
            <p role="status" className="mt-1 text-sm text-ink/70">
              Showing {found}.
            </p>
          )}
        </div>
        <div className="relative">
          <ThemeMap style={shownStyle} target={target} images={images} />
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
            disabled={!generatedStyle || problems.length > 0}
            onClick={download}
            className={primaryButton.replace("px-5 py-3 text-base", "px-4 py-2.5 text-sm")}
          >
            Download JSON
          </button>
          <button
            type="button"
            disabled={!generatedStyle || problems.length > 0}
            onClick={() => void copy()}
            className={secondaryButton}
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
          {patterns.length > 0 && (
            <button
              type="button"
              disabled={problems.length > 0}
              onClick={() => void downloadPackage()}
              className={secondaryButton}
            >
              Download package (.zip)
            </button>
          )}
          <p className="text-sm text-ink/60">
            {generatedStyle
              ? `${fileName} · the complete style, ${BASE_STYLE.layers.length} layers, ${changed} of ${BASE_COLORS.length} colours changed${
                  patterns.length ? `, ${patterns.length} texture${patterns.length === 1 ? "" : "s"}` : ""
                }`
              : "Generate a theme or a texture to enable these."}
          </p>
        </div>
        {patterns.length > 0 && (
          <p className="mt-2 text-sm text-ink/70">
            The style JSON names its textures but cannot contain them. Use the
            package: it holds the JSON plus every SVG it needs, ready to add
            to the style&apos;s images in Mapbox Studio (see README.txt inside).
          </p>
        )}
        {problems.length > 0 && (
          <p role="alert" className="mt-2 text-sm text-terracotta">
            The style did not pass its checks, so it cannot be exported: {problems[0]}
          </p>
        )}
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
