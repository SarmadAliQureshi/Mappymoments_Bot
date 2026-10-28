// SVG textures ("patterns") injected into the map style. A style can only
// name its images; the SVGs themselves travel next to it and are uploaded to
// the style's sprite in Mapbox.

import { BASE_STYLE, type MapStyle } from "@/lib/themes/theme";

export interface Pattern {
  /** Image name the style refers to; also the SVG's file name. */
  name: string;
  target: PatternTargetId;
  svg: string;
  /** What it was made from: a prompt, or "Uploaded". */
  source: string;
}

export type PatternTargetId =
  | "parks"
  | "water"
  | "land"
  | "mountains"
  | "institutional"
  | "urban";

export interface PatternTarget {
  id: PatternTargetId;
  label: string;
  /** Layers of the base style that take the texture. */
  layers: string[];
}

interface Layer {
  id: string;
  type: string;
  "source-layer"?: string;
  filter?: unknown;
}

// Which texture target a layer belongs to, judged from the data it draws.
function targetOf(layer: Layer): PatternTargetId | null {
  const source = layer["source-layer"] ?? "";
  const id = layer.id.toLowerCase();
  const filter = JSON.stringify(layer.filter ?? "").toLowerCase();
  if (layer.type === "background") return "land";
  if (layer.type !== "fill") return null;
  if (source === "water") return "water";
  if (source === "hillshade") return "mountains";
  if (source.startsWith("ne_10m_urban")) return "urban";
  if (source === "landuse") {
    if (/park|grass|wood|cemet|pitch/.test(id) || /park|grass|wood|cemetery/.test(filter)) {
      return "parks";
    }
    if (/hospital|school|industrial|airport/.test(id + filter)) return "institutional";
  }
  return null;
}

const LABELS: Record<PatternTargetId, string> = {
  parks: "Parks, grass and woods",
  water: "Water",
  land: "Land (background)",
  mountains: "Mountains (hillshade)",
  institutional: "Schools, hospitals and airports",
  urban: "Built-up areas (zoomed out)",
};

export const PATTERN_TARGETS: PatternTarget[] = (
  Object.keys(LABELS) as PatternTargetId[]
).map((id) => ({
  id,
  label: LABELS[id],
  layers: (BASE_STYLE.layers as Layer[])
    .filter((layer) => targetOf(layer) === id)
    .map((layer) => layer.id),
}));

export function getTarget(id: unknown): PatternTarget | undefined {
  return PATTERN_TARGETS.find((target) => target.id === id);
}

/** Puts each pattern on its target's layers. The style is changed in place. */
export function applyPatterns(style: MapStyle, patterns: Pattern[]): MapStyle {
  for (const pattern of patterns) {
    const target = getTarget(pattern.target);
    if (!target) continue;
    for (const layer of style.layers) {
      if (!target.layers.includes(layer.id)) continue;
      const property = layer.type === "background" ? "background-pattern" : "fill-pattern";
      layer.paint = { ...(layer.paint ?? {}), [property]: pattern.name };
    }
  }
  return style;
}

/** A sprite-safe image name: letters, digits and dashes. */
export function patternName(text: string): string {
  return (
    "ai-" +
    (text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "texture")
  );
}

const MAX_SVG_BYTES = 150_000;
// Mapbox draws sprite SVGs with a limited renderer, and these files end up
// in a published style, so only plain drawing elements are let through.
const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "path", "lineargradient", "radialgradient", "stop", "clippath", "use", "title",
]);

/**
 * Checks an SVG texture. Returns the cleaned SVG, or an error explaining
 * why it cannot be used.
 */
export function checkSvg(input: string): { svg: string } | { error: string } {
  let svg = input.trim();
  // Models sometimes wrap the SVG in a code fence or add XML prologues.
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start < 0 || end < 0) return { error: "This is not an SVG image." };
  svg = svg.slice(start, end + 6);
  if (svg.length > MAX_SVG_BYTES) return { error: "The SVG is too large (max 150 KB)." };

  for (const [, tag] of svg.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)) {
    if (!ALLOWED_ELEMENTS.has(tag.toLowerCase())) {
      return { error: `The SVG uses <${tag}>, which map textures cannot use.` };
    }
  }
  if (/\son\w+\s*=/i.test(svg)) return { error: "The SVG contains script handlers." };
  if (/(?:href|src)\s*=\s*["'](?!#)/i.test(svg)) {
    return { error: "The SVG links to outside files; textures must be self-contained." };
  }
  if (/url\(\s*["']?(?!#)/i.test(svg)) {
    return { error: "The SVG refers to outside files; textures must be self-contained." };
  }

  // Mapbox needs a pixel size; take it from the viewBox when it is missing.
  const open = svg.slice(0, svg.indexOf(">") + 1);
  const width = /\swidth\s*=\s*["']?(\d+(?:\.\d+)?)/.exec(open)?.[1];
  const height = /\sheight\s*=\s*["']?(\d+(?:\.\d+)?)/.exec(open)?.[1];
  if (!width || !height) {
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(open);
    if (!box) return { error: "The SVG has no size (width/height or viewBox)." };
    svg = svg.replace("<svg", `<svg width="${box[1]}" height="${box[2]}"`);
  }
  const size = Math.max(Number(width ?? 0), Number(height ?? 0));
  if (size > 1024) return { error: "The SVG tile is too large (max 1024 px on a side)." };
  if (!/xmlns\s*=/.test(open)) {
    svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return { svg };
}
