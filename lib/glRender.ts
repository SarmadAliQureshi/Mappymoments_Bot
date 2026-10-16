// Draws Mapbox Studio styles in the browser with Mapbox GL. Because the map
// is drawn here from the style's layers, their colours can be changed live.

import type { Map as MapboxMap } from "mapbox-gl";
import { MAPBOX_TOKEN } from "@/lib/tileStyles";

export interface ColorGroup {
  id: string;
  label: string;
  /** Current colour of the group in the style, as #rrggbb. */
  color: string;
}

export interface GlRequest {
  styleUrl: string;
  center: { lat: number; lng: number };
  /** Mapbox GL zoom (512px tiles). */
  zoom: number;
  width: number;
  height: number;
  /** Colour overrides keyed by group id. */
  colors: Record<string, string>;
}

export interface GlResult {
  canvas: HTMLCanvasElement;
  groups: ColorGroup[];
}

const GROUPS: { id: string; label: string }[] = [
  { id: "land", label: "Land" },
  { id: "water", label: "Water" },
  { id: "main-roads", label: "Main roads" },
  { id: "streets", label: "Streets" },
  { id: "green", label: "Parks & green" },
  { id: "buildings", label: "Buildings" },
];

const COLOR_PROPERTY: Record<string, string> = {
  background: "background-color",
  fill: "fill-color",
  line: "line-color",
  "fill-extrusion": "fill-extrusion-color",
};

interface StyleLayer {
  id: string;
  type: string;
  "source-layer"?: string;
  layout?: { visibility?: string };
  paint?: Record<string, unknown>;
}

interface GroupedLayer {
  layerId: string;
  group: string;
  property: string;
  original: unknown;
}

// Which colour group a style layer belongs to, judged from the data it draws.
function classify(layer: StyleLayer): string | null {
  const source = layer["source-layer"] ?? "";
  const id = layer.id.toLowerCase();
  if (layer.type === "background") return "land";
  if (source === "water" || source === "waterway") {
    return layer.type === "fill" || layer.type === "line" ? "water" : null;
  }
  if (source === "road" && layer.type === "line") {
    // Casings are the outlines of roads and keep their own colour.
    if (id.includes("case")) return null;
    return /motorway|trunk|primary|secondary/.test(id) ? "main-roads" : "streets";
  }
  if (source === "building" || source === "structure") {
    return layer.type === "fill" || layer.type === "fill-extrusion" ? "buildings" : null;
  }
  if (layer.type === "fill" && /landuse|urban/.test(source)) {
    return /park|grass|wood|pitch|cemet|golf|green|forest|scrub/.test(id)
      ? "green"
      : "land";
  }
  return null;
}

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour as #rrggbb, or null if it is not a plain colour. */
function toHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.fillStyle = "#000000";
  probe.fillStyle = value;
  const parsed = probe.fillStyle;
  if (parsed.startsWith("#")) return parsed;
  const parts = parsed.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return `#${parts
    .slice(0, 3)
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface Session {
  map: MapboxMap;
  container: HTMLDivElement;
  styleUrl: string;
  layers: GroupedLayer[];
  groups: ColorGroup[];
}

let session: Promise<Session> | null = null;

function waitFor(map: MapboxMap, event: "idle" | "style.load", ms = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The map took too long to draw. Please try again.")),
      ms,
    );
    map.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readStyle(target: Session) {
  const layers = (target.map.getStyle()?.layers ?? []) as StyleLayer[];
  target.layers = [];
  for (const layer of layers) {
    if (layer.layout?.visibility === "none") continue;
    const group = classify(layer);
    const property = COLOR_PROPERTY[layer.type];
    if (!group || !property) continue;
    target.layers.push({
      layerId: layer.id,
      group,
      property,
      original: layer.paint?.[property],
    });
  }

  target.groups = [];
  for (const { id, label } of GROUPS) {
    // The group's colour is the one most of its layers use.
    const counts = new Map<string, number>();
    for (const layer of target.layers) {
      if (layer.group !== id) continue;
      const hex = toHex(layer.original);
      if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    if (!target.layers.some((layer) => layer.group === id)) continue;
    const [color] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["#888888"];
    target.groups.push({ id, label, color });
  }
}

async function open(request: GlRequest): Promise<Session> {
  const mapboxgl = (await import("mapbox-gl")).default;
  mapboxgl.accessToken = MAPBOX_TOKEN;

  // The map is drawn off screen and copied onto the artwork canvas.
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-20000px;top:0;width:${request.width}px;height:${request.height}px;visibility:hidden;`;
  document.body.appendChild(container);

  const map = new mapboxgl.Map({
    container,
    style: request.styleUrl,
    center: [request.center.lng, request.center.lat],
    zoom: request.zoom,
    projection: "mercator",
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    fadeDuration: 0,
    trackResize: false,
  });
  const created: Session = {
    map,
    container,
    styleUrl: request.styleUrl,
    layers: [],
    groups: [],
  };
  await waitFor(map, "style.load");
  readStyle(created);
  return created;
}

async function draw(request: GlRequest): Promise<GlResult> {
  session ??= open(request);
  let current: Session;
  try {
    current = await session;
  } catch (error) {
    session = null;
    throw error;
  }
  const { map, container } = current;

  if (current.styleUrl !== request.styleUrl) {
    map.setStyle(request.styleUrl);
    await waitFor(map, "style.load");
    map.setProjection("mercator");
    current.styleUrl = request.styleUrl;
    readStyle(current);
  }

  if (
    container.clientWidth !== request.width ||
    container.clientHeight !== request.height
  ) {
    container.style.width = `${request.width}px`;
    container.style.height = `${request.height}px`;
    map.resize();
  }

  for (const layer of current.layers) {
    const value = request.colors[layer.group] ?? layer.original;
    if (value !== undefined) {
      map.setPaintProperty(layer.layerId, layer.property as never, value as never);
    }
  }

  map.jumpTo({ center: [request.center.lng, request.center.lat], zoom: request.zoom });
  map.triggerRepaint();
  await waitFor(map, "idle");

  const canvas = document.createElement("canvas");
  canvas.width = request.width;
  canvas.height = request.height;
  canvas
    .getContext("2d", { willReadFrequently: true })
    ?.drawImage(map.getCanvas(), 0, 0, request.width, request.height);
  return { canvas, groups: current.groups };
}

// One map draws every request, so requests run one at a time and only the
// newest waiting one is kept (older ones are stale by then, e.g. mid-drag).
export class SupersededError extends Error {}

let running = false;
let waiting: {
  request: GlRequest;
  resolve: (result: GlResult) => void;
  reject: (error: unknown) => void;
} | null = null;

async function pump() {
  if (running || !waiting) return;
  running = true;
  const job = waiting;
  waiting = null;
  try {
    job.resolve(await draw(job.request));
  } catch (error) {
    job.reject(error);
  }
  running = false;
  void pump();
}

export function renderGl(request: GlRequest): Promise<GlResult> {
  return new Promise((resolve, reject) => {
    waiting?.reject(new SupersededError());
    waiting = { request, resolve, reject };
    void pump();
  });
}
