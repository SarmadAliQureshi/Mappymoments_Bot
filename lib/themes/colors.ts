// Reading and writing the colour formats that appear in a Mapbox style.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(rgba?|hsla?)\(([^)]+)\)$/i;

export function isColor(value: unknown): value is string {
  return typeof value === "string" && parseColor(value) !== null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1 ? [chroma, x, 0]
    : sector < 2 ? [x, chroma, 0]
    : sector < 3 ? [0, chroma, x]
    : sector < 4 ? [0, x, chroma]
    : sector < 5 ? [x, 0, chroma]
    : [chroma, 0, x];
  const m = l - chroma / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function rgbToHsl({ r, g, b }: Rgba): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn ? ((gn - bn) / d) % 6
    : max === gn ? (bn - rn) / d + 2
    : (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function parseColor(value: string): Rgba | null {
  const text = value.trim();
  const hex = HEX.exec(text)?.[1];
  if (hex) {
    const full =
      hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const match = FUNCTIONAL.exec(text);
  if (!match) return null;
  const parts = match[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const number = (part: string) => parseFloat(part);
  const alpha = parts[3] === undefined
    ? 1
    : parts[3].endsWith("%") ? number(parts[3]) / 100 : number(parts[3]);
  if (parts.slice(0, 3).some((part) => Number.isNaN(number(part)))) return null;
  if (match[1].toLowerCase().startsWith("hsl")) {
    const [r, g, b] = hslToRgb(number(parts[0]), number(parts[1]) / 100, number(parts[2]) / 100);
    return { r, g, b, a: alpha };
  }
  return { r: number(parts[0]), g: number(parts[1]), b: number(parts[2]), a: alpha };
}

const byte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

export function toHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => byte(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Writes `color` in the same notation as `original`, keeping the original's
 * alpha: hex stays hex, rgba() stays rgba(), hsl() stays hsl().
 */
export function formatLike(original: string, color: Rgba): string {
  const source = parseColor(original);
  const alpha = source?.a ?? 1;
  const text = original.trim();
  const kind = FUNCTIONAL.exec(text)?.[1].toLowerCase();
  const spaced = text.includes(", ");
  const join = (parts: (string | number)[]) => parts.join(spaced ? ", " : ",");

  if (kind?.startsWith("hsl")) {
    const { h, s, l } = rgbToHsl(color);
    const parts: (string | number)[] = [
      Math.round(h),
      `${Math.round(s * 100)}%`,
      `${Math.round(l * 100)}%`,
    ];
    if (kind === "hsla") parts.push(alpha);
    return `${kind}(${join(parts)})`;
  }
  if (kind?.startsWith("rgb")) {
    const parts: (string | number)[] = [byte(color.r), byte(color.g), byte(color.b)];
    if (kind === "rgba") parts.push(alpha);
    return `${kind}(${join(parts)})`;
  }
  const hex = toHex(color);
  const hadAlpha = (HEX.exec(text)?.[1].length ?? 6) % 4 === 0;
  return hadAlpha ? `${hex}${byte(alpha * 255).toString(16).padStart(2, "0")}` : hex;
}
