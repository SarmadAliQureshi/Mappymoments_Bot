// Recolouring the base map style. Everything here only ever touches colour
// strings in layer paint properties; the rest of the style is left as it is.

import baseStyleJson from "@/lib/themes/base-style.json";
import { formatLike, isColor, parseColor, rgbToHsl, toHex } from "@/lib/themes/colors";

interface StyleLayer {
  id: string;
  type: string;
  "source-layer"?: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

export interface MapStyle {
  layers: StyleLayer[];
  [key: string]: unknown;
}

export const BASE_STYLE = baseStyleJson as unknown as MapStyle;

/** Old colour (exactly as written in the base) -> new colour. */
export type ColorMapping = Record<string, string>;

export interface ColorEntry {
  /** The colour exactly as written in the base style. */
  color: string;
  hex: string;
  /** What it paints, e.g. "streets", "water", "labels". */
  roles: string[];
  /** Layers that use it and are switched on. */
  visibleLayers: string[];
  hiddenLayers: string[];
}

const isColorProperty = (name: string) => name.includes("color");
export const isPatternProperty = (name: string) => name.endsWith("-pattern");

// What a layer's colour is for, judged from the data and property it paints.
function roleOf(layer: StyleLayer, property: string): string {
  const source = layer["source-layer"] ?? "";
  const id = layer.id.toLowerCase();
  if (property === "text-halo-color" || property === "icon-halo-color") return "label halos";
  if (layer.type === "symbol") return "labels";
  if (layer.type === "background") return "background";
  if (source === "water" || source === "waterway") {
    return layer.type === "fill" ? "water" : "water outline";
  }
  if (source === "hillshade") return "hillshade (mountain shading)";
  if (source === "admin") return "boundaries";
  if (source === "aeroway") return "airports";
  if (source === "structure" || source === "building") return "buildings and structures";
  if (source === "road") {
    if (id.includes("case")) return "road casings (outlines)";
    if (id.includes("rail")) return "railways";
    if (/motorway|trunk|primary|secondary/.test(id)) return "main roads";
    return "streets";
  }
  if (/landuse|urban/.test(source)) {
    if (/park|grass|wood|pitch|cemet|golf|forest|scrub/.test(id)) {
      return layer.type === "line" ? "park outlines" : "parks and green space";
    }
    if (/hospital|school|industrial/.test(id)) return "institutional land";
    return "land";
  }
  return layer.type;
}

/** Calls `visit` for every colour string in every layer's paint properties. */
function eachColor(
  style: MapStyle,
  visit: (color: string, layer: StyleLayer, property: string, set: (next: string) => void) => void,
) {
  const walk = (
    holder: Record<string, unknown> | unknown[],
    key: string | number,
    layer: StyleLayer,
    property: string,
  ) => {
    const value = (holder as Record<string | number, unknown>)[key];
    if (isColor(value)) {
      visit(value, layer, property, (next) => {
        (holder as Record<string | number, unknown>)[key] = next;
      });
    } else if (Array.isArray(value)) {
      // Colours inside expressions and zoom stops.
      value.forEach((_, index) => walk(value, index, layer, property));
    } else if (value && typeof value === "object") {
      for (const inner of Object.keys(value)) {
        walk(value as Record<string, unknown>, inner, layer, property);
      }
    }
  };
  for (const layer of style.layers) {
    for (const property of Object.keys(layer.paint ?? {})) {
      if (isColorProperty(property)) walk(layer.paint!, property, layer, property);
    }
  }
}

/** Every unique colour in the base style, with what it is used for. */
export function extractColors(style: MapStyle = BASE_STYLE): ColorEntry[] {
  const entries = new Map<string, ColorEntry>();
  // How many visible layers use each colour for each role.
  const weights = new Map<string, Map<string, number>>();
  eachColor(style, (color, layer, property) => {
    let entry = entries.get(color);
    if (!entry) {
      entry = {
        color,
        hex: toHex(parseColor(color)!),
        roles: [],
        visibleLayers: [],
        hiddenLayers: [],
      };
      entries.set(color, entry);
      weights.set(color, new Map());
    }
    const hidden = layer.layout?.visibility === "none";
    (hidden ? entry.hiddenLayers : entry.visibleLayers).push(layer.id);
    const role = roleOf(layer, property);
    const tally = weights.get(color)!;
    tally.set(role, (tally.get(role) ?? 0) + (hidden ? 0.01 : 1));
  });
  for (const [color, entry] of entries) {
    // The role a colour is used for most comes first.
    entry.roles = [...weights.get(color)!.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([role]) => role);
  }
  return [...entries.values()].sort(
    (x, y) => y.visibleLayers.length - x.visibleLayers.length,
  );
}

export const BASE_COLORS = extractColors();

/**
 * Cleans a mapping that came from the AI: unknown keys are dropped, missing
 * ones keep the base colour, and every new colour is rewritten in the same
 * notation (and with the same alpha) as the colour it replaces.
 */
export function normalizeMapping(raw: unknown): { mapping: ColorMapping; missing: string[] } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mapping: ColorMapping = {};
  const missing: string[] = [];
  for (const { color } of BASE_COLORS) {
    const parsed = typeof input[color] === "string" ? parseColor(input[color]) : null;
    if (parsed) mapping[color] = formatLike(color, parsed);
    else {
      mapping[color] = color;
      missing.push(color);
    }
  }
  return { mapping, missing };
}

/** A copy of the base style with its colours replaced. */
export function applyMapping(mapping: ColorMapping): MapStyle {
  const style = structuredClone(BASE_STYLE);
  eachColor(style, (color, _layer, _property, set) => {
    const next = mapping[color];
    if (next && next !== color) set(next);
  });
  return style;
}

/**
 * Confirms that `style` differs from the base in colour values only. Returns
 * a list of problems; an empty list means it is safe to use.
 */
export function validateStyle(style: MapStyle, patternNames: string[] = []): string[] {
  const problems: string[] = [];
  const base = BASE_STYLE;
  if (!Array.isArray(style.layers) || style.layers.length !== base.layers.length) {
    return [`Layer count changed (${style.layers?.length} instead of ${base.layers.length}).`];
  }

  const compare = (a: unknown, b: unknown, path: string, colorAllowed: boolean) => {
    if (problems.length > 5) return;
    if (a === b) return;
    if (colorAllowed && isColor(a) && isColor(b)) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((item, index) => compare(item, b[index], `${path}[${index}]`, colorAllowed));
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      let before = a as Record<string, unknown>;
      let after = b as Record<string, unknown>;
      // In a layer's paint, a texture may be added or swapped, but only for
      // one of the textures being injected.
      if (/^\.?layers\[\d+\]\.paint$/.test(path)) {
        for (const key of Object.keys(after)) {
          if (!isPatternProperty(key) || after[key] === before[key]) continue;
          if (!patternNames.includes(after[key] as string)) {
            problems.push(`${path}.${key}: uses an image that is not one of the textures.`);
          }
        }
        const unpatterned = (object: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(object).filter(([key]) => !isPatternProperty(key)));
        before = unpatterned(before);
        after = unpatterned(after);
      }
      const keysA = Object.keys(before);
      const keysB = Object.keys(after);
      if (keysA.length !== keysB.length || keysA.some((key) => !(key in after))) {
        problems.push(`${path}: properties were added or removed.`);
        return;
      }
      for (const key of keysA) {
        // Only layers[n].paint.<something>-color may hold a different colour.
        const allowed =
          colorAllowed || (/^\.?layers\[\d+\]\.paint$/.test(path) && isColorProperty(key));
        compare(before[key], after[key], `${path}.${key}`, allowed);
      }
      return;
    }
    problems.push(`${path}: changed to something that is not a colour.`);
  };

  base.layers.forEach((layer, index) => {
    if (style.layers[index]?.id !== layer.id) {
      problems.push(`Layer ${index} is "${style.layers[index]?.id}" instead of "${layer.id}".`);
    }
  });
  if (!problems.length) compare(base, style, "", false);
  return problems.map((problem) => problem.replace(/^\./, ""));
}

/** Lightness and saturation, for describing a colour to the AI. */
export function describeTone(color: string): string {
  const { h, s, l } = rgbToHsl(parseColor(color)!);
  return `hue ${Math.round(h)}, saturation ${Math.round(s * 100)}%, lightness ${Math.round(l * 100)}%`;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "custom"
  );
}
