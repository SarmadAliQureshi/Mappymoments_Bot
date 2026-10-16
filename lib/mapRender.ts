// Draws the real Mappy Moments map artwork onto a canvas: live map tiles for
// real locations, a bottom fade, pins and the title block of the chosen design.

import { renderGl, type ColorGroup } from "@/lib/glRender";
import { tileUrl, type TileStyle } from "@/lib/tileStyles";

const TILE = 256;
const PIN_COLOR = "#B5592E";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Place extends Coordinates {
  name: string;
  country: string;
}

// The three starting designs offered on mappymoments.com.
export type DesignId = "urban" | "spanning" | "commitment";

export const DESIGNS: { id: DesignId; name: string; description: string }[] = [
  {
    id: "urban",
    name: "Urban Canvas",
    description: "A city-focused map of one place.",
  },
  {
    id: "spanning",
    name: "Spanning the Distance",
    description: "Two places joined by a line, for connections across the miles.",
  },
  {
    id: "commitment",
    name: "Coordinates of Commitment",
    description: "A place with your photo and names, for a moment worth keeping.",
  },
];

export interface MapSpec {
  design: DesignId;
  /** One place, or two for Spanning the Distance. */
  places: Place[];
  /** Where the middle of the map is; moves when the map is dragged. */
  center: Coordinates;
  zoom: number;
  style: TileStyle;
  /** Names or a short line shown as the title; falls back to the place. */
  title: string;
  photo: HTMLImageElement | null;
  /** Colour overrides for Mapbox styles, keyed by colour group. */
  colors: Record<string, string>;
  /** Canvas size in pixels; its ratio is the product's print ratio. */
  width: number;
  height: number;
}

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 16;
export const DEFAULT_ZOOM = 12;

const tileCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadTile(url: string): Promise<HTMLImageElement | null> {
  let pending = tileCache.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      // Needed so the finished canvas can be read back and downloaded.
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    tileCache.set(url, pending);
  }
  return pending;
}

/** Web Mercator: position of a coordinate on a 256px world map. */
function project({ lat, lng }: Coordinates) {
  const scale = TILE;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number): Coordinates {
  const scale = TILE;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return {
    lat: Math.min(85, Math.max(-85, lat)),
    lng: ((((x / scale) * 360 - 180 + 540) % 360) + 360) % 360 - 180,
  };
}

/** Canvas pixels per pixel of the 256px world map. */
function worldScale(zoom: number, width: number, height: number) {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  // The map is drawn enlarged so it keeps a sensible level of detail on a
  // large canvas.
  return 2 ** clamped * (Math.max(width, height) / 900);
}

/** New map centre after dragging the artwork by a number of canvas pixels. */
export function panCenter(
  spec: Pick<MapSpec, "center" | "zoom" | "width" | "height">,
  dx: number,
  dy: number,
): Coordinates {
  const scale = worldScale(spec.zoom, spec.width, spec.height);
  const centre = project(spec.center);
  return unproject(centre.x - dx / scale, centre.y - dy / scale);
}

/** Centre and zoom that show every place with room around them. */
export function fitPlaces(places: Place[]): { center: Coordinates; zoom: number } {
  if (places.length < 2) {
    return { center: { lat: places[0].lat, lng: places[0].lng }, zoom: DEFAULT_ZOOM };
  }
  const [a, b] = places.map((place) => project(place));
  const center = unproject((a.x + b.x) / 2, (a.y + b.y) / 2);
  const distance = Math.hypot(a.x - b.x, a.y - b.y) / TILE;
  // The two pins should span roughly 40% of the artwork's long side.
  const zoom = Math.log2((0.4 * 900) / (TILE * Math.max(distance, 1e-6)));
  return {
    center,
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 2) / 2)),
  };
}

export function formatCoordinates(place: Coordinates): string {
  const lat = `${Math.abs(place.lat).toFixed(4)}°${place.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(place.lng).toFixed(4)}°${place.lng >= 0 ? "E" : "W"}`;
  return `${lat}, ${lng}`;
}

export function defaultTitle(places: Place[]): string {
  return places.map((place) => place.name).join(" & ");
}

function fontFamily(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value ? `${value}, ${fallback}` : fallback;
}

/** Average colour of the strip along the bottom, used as the fade colour. */
function samplePaper(context: CanvasRenderingContext2D, w: number, h: number) {
  const strip = Math.max(4, Math.round(h * 0.06));
  const { data } = context.getImageData(0, h - strip, w, strip);
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / count, g: g / count, b: b / count };
}

/** A heart whose bottom tip sits on (x, y). */
function drawHeart(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.fillStyle = PIN_COLOR;
  context.strokeStyle = "rgba(255,255,255,0.9)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, 0);
  context.bezierCurveTo(-14, -9, -11, -22, 0, -15);
  context.bezierCurveTo(11, -22, 14, -9, 0, 0);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawPhoto(
  context: CanvasRenderingContext2D,
  photo: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
) {
  // Cover-fit the photo inside the circle.
  const side = Math.min(photo.naturalWidth, photo.naturalHeight);
  const sx = (photo.naturalWidth - side) / 2;
  const sy = (photo.naturalHeight - side) / 2;
  context.save();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  context.drawImage(photo, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2);
  context.restore();
  context.lineWidth = radius * 0.07;
  context.strokeStyle = "#FFF9EF";
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
}

function drawTitleBlock(
  context: CanvasRenderingContext2D,
  spec: MapSpec,
  paper: { r: number; g: number; b: number },
) {
  const { width: w, height: h, places, design } = spec;
  const unit = Math.min(w, h);
  const showPhoto = design === "commitment" && !!spec.photo;
  const fadeTop = h - unit * (showPhoto ? 0.5 : 0.36);
  const paperRgb = `${Math.round(paper.r)}, ${Math.round(paper.g)}, ${Math.round(paper.b)}`;

  const fade = context.createLinearGradient(0, fadeTop, 0, h);
  fade.addColorStop(0, `rgba(${paperRgb}, 0)`);
  fade.addColorStop(0.55, `rgba(${paperRgb}, 0.9)`);
  fade.addColorStop(1, `rgba(${paperRgb}, 1)`);
  context.fillStyle = fade;
  context.fillRect(0, fadeTop, w, h - fadeTop);

  const luminance = 0.299 * paper.r + 0.587 * paper.g + 0.114 * paper.b;
  const ink = luminance > 140 ? "#2B2A28" : "#FFF9EF";
  const serif = fontFamily("--font-lora", "Georgia, serif");
  const sans = fontFamily("--font-inter", "Helvetica, Arial, sans-serif");
  const centre = w / 2;

  context.fillStyle = ink;
  context.strokeStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";

  const title = spec.title.trim() || defaultTitle(places);
  const titleSize = unit * (design === "urban" ? 0.07 : 0.06);
  const titleY = h - unit * 0.125;
  context.font = `${design === "urban" ? 700 : 400} ${titleSize}px ${serif}`;
  context.fillText(title, centre, titleY, w * 0.9);

  if (showPhoto && spec.photo) {
    const radius = unit * 0.11;
    drawPhoto(context, spec.photo, centre, titleY - titleSize - radius * 1.15, radius);
  }

  const smallSize = unit * 0.022;
  const lineY = h - unit * 0.08;
  context.lineWidth = Math.max(1, unit * 0.0016);

  if (design === "spanning" && places.length > 1) {
    // Both coordinates on one line with a heart between them.
    context.font = `400 ${smallSize}px ${sans}`;
    const gap = unit * 0.035;
    context.textAlign = "right";
    context.fillText(formatCoordinates(places[0]), centre - gap, lineY);
    context.textAlign = "left";
    context.fillText(formatCoordinates(places[1]), centre + gap, lineY);
    drawHeart(context, centre, lineY + smallSize * 0.1, smallSize * 1.5);
    context.textAlign = "center";
    context.fillStyle = ink;
    context.font = `400 ${smallSize}px ${sans}`;
    context.fillText(
      places.map((place) => place.name).join("  ·  ").toUpperCase(),
      centre,
      h - unit * 0.04,
      w * 0.9,
    );
    return;
  }

  // A custom title leaves room to say where it is.
  const place = places[0];
  const caption = spec.title.trim()
    ? [place.name, place.country].filter(Boolean).join(", ")
    : place.country;
  if (caption) {
    // Spaced caps with a thin rule on either side.
    const spaced = caption.toUpperCase().split("").join(" ");
    context.font = `400 ${unit * 0.026}px ${sans}`;
    context.fillText(spaced, centre, lineY);
    const half = context.measureText(spaced).width / 2 + unit * 0.03;
    const rule = unit * 0.13;
    for (const direction of [-1, 1]) {
      context.beginPath();
      context.moveTo(centre + direction * half, lineY - unit * 0.009);
      context.lineTo(centre + direction * (half + rule), lineY - unit * 0.009);
      context.stroke();
    }
  }
  context.font = `400 ${smallSize}px ${sans}`;
  context.fillText(formatCoordinates(place), centre, h - unit * 0.04);
}

async function drawTiles(
  context: CanvasRenderingContext2D,
  spec: MapSpec,
  scale: number,
  originX: number,
  originY: number,
) {
  const { width: w, height: h, style } = spec;
  const z = Math.min(
    Math.floor(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, spec.zoom))),
    style.maxZoom ?? 19,
  );
  const count = 2 ** z;
  const size = (TILE * scale) / count;

  const jobs: Promise<boolean>[] = [];
  for (let ty = Math.floor(originY / size); ty * size < originY + h; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(originX / size); tx * size < originX + w; tx++) {
      const wrapped = ((tx % count) + count) % count;
      const dx = tx * size - originX;
      const dy = ty * size - originY;
      jobs.push(
        loadTile(tileUrl(style, z, wrapped, ty)).then((image) => {
          if (!image) return false;
          // Overlap by a pixel so no seams show between tiles.
          context.drawImage(image, Math.floor(dx), Math.floor(dy), Math.ceil(size) + 1, Math.ceil(size) + 1);
          return true;
        }),
      );
    }
  }

  const results = await Promise.all(jobs);
  if (results.filter(Boolean).length < results.length / 2) {
    throw new Error(
      `The "${style.name}" map style could not be loaded for this place and zoom.`,
    );
  }
}

export interface MapArtwork {
  canvas: HTMLCanvasElement;
  /** Colour groups that can be changed; empty for raster tile styles. */
  groups: ColorGroup[];
}

/**
 * Renders the artwork. Tiles are cached, so drawing the same view in another
 * style only costs the tile downloads for that style.
 */
export async function renderMapArtwork(spec: MapSpec): Promise<MapArtwork> {
  const { width: w, height: h, style } = spec;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot draw the map.");

  const scale = worldScale(spec.zoom, w, h);
  const centre = project(spec.center);
  const originX = centre.x * scale - w / 2;
  const originY = centre.y * scale - h / 2;

  let groups: ColorGroup[] = [];
  if (style.gl) {
    const drawn = await renderGl({
      styleUrl: style.gl,
      center: spec.center,
      // Mapbox GL counts zoom on 512px tiles.
      zoom: Math.log2(scale) - 1,
      width: w,
      height: h,
      colors: spec.colors,
    });
    context.drawImage(drawn.canvas, 0, 0);
    groups = drawn.groups;
  } else {
    await drawTiles(context, spec, scale, originX, originY);
  }

  const pins = spec.places.map((place) => {
    const point = project(place);
    return { x: point.x * scale - originX, y: point.y * scale - originY };
  });
  const unit = Math.min(w, h);

  if (spec.design === "spanning" && pins.length > 1) {
    context.save();
    context.strokeStyle = PIN_COLOR;
    context.lineWidth = Math.max(2, unit * 0.004);
    context.setLineDash([unit * 0.016, unit * 0.012]);
    context.beginPath();
    context.moveTo(pins[0].x, pins[0].y - unit * 0.012);
    context.lineTo(pins[1].x, pins[1].y - unit * 0.012);
    context.stroke();
    context.restore();
  }

  drawTitleBlock(context, spec, samplePaper(context, w, h));
  for (const pin of pins) drawHeart(context, pin.x, pin.y, unit * 0.05);
  return { canvas, groups };
}

/** The tile containing a point, for small style previews. */
export function tileAt(point: Coordinates, z: number): { x: number; y: number } {
  const position = project(point);
  const count = 2 ** z;
  return {
    x: Math.floor((position.x / TILE) * count),
    y: Math.floor((position.y / TILE) * count),
  };
}
