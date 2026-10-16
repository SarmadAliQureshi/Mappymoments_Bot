// Places the real map artwork onto an AI-generated product photo.
//
// The photo is generated with the product's print area painted solid magenta.
// We find that area, then for every magenta pixel look up the matching pixel
// of the map and multiply it by the photo's own light and shadow. Nothing here
// calls an API, so changing the map style is instant.

import type { PrintShape } from "@/lib/products";

export interface PrintArea {
  width: number;
  height: number;
  /** 0..1 coverage of each pixel by the print area. */
  alpha: Float32Array;
  /** Lighting of each pixel relative to the area's typical brightness. */
  shade: Float32Array;
  /** Top and bottom edge of the area in every column. */
  top: Float32Array;
  bottom: Float32Array;
  left: number;
  right: number;
  /** Stray pink pixels just outside the area, to be neutralised. */
  spill: Int32Array;
}

// How "magenta" a pixel is: 1 for pure magenta, 0 for any grey or warm tone.
// Measured relative to brightness so magenta in deep shadow still counts.
function magentaness(r: number, g: number, b: number) {
  const peak = Math.max(r, b);
  return peak < 40 ? 0 : (Math.min(r, b) - g) / peak;
}

// A blob starts from strongly magenta pixels (CORE) and spreads through
// weaker ones (SPREAD), which covers the darker, shaded sides of a mug.
const CORE = 0.45;
const SPREAD = 0.2;
const FRINGE = 0.08;
/**
 * Share of a mug's wrap-around print that the camera can see: half the mug's
 * circumference (a mug is about as wide as its print is tall) over the print
 * width.
 */
export function wrapVisible(printWidth: number, printHeight: number): number {
  return Math.min(1, ((Math.PI / 2) * printHeight) / printWidth);
}

function smooth(values: Float32Array, from: number, to: number, radius: number) {
  const copy = values.slice();
  for (let x = from; x <= to; x++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(from, x - radius); k <= Math.min(to, x + radius); k++) {
      sum += copy[k];
      n++;
    }
    values[x] = sum / n;
  }
}

/** Finds the magenta print area in the scene, or null if there is none. */
export function findPrintArea(scene: ImageData): PrintArea | null {
  const { width: w, height: h, data } = scene;
  const total = w * h;
  const score = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = data[o];
    const b = data[o + 2];
    score[i] = magentaness(r, data[o + 1], b);
  }

  // Largest connected blob of strongly magenta pixels.
  const label = new Int32Array(total);
  const stack = new Int32Array(total);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < total; start++) {
    if (score[start] < CORE || label[start]) continue;
    next++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      if (x > 0 && !label[i - 1] && score[i - 1] >= SPREAD) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && !label[i + 1] && score[i + 1] >= SPREAD) { label[i + 1] = next; stack[top++] = i + 1; }
      if (i >= w && !label[i - w] && score[i - w] >= SPREAD) { label[i - w] = next; stack[top++] = i - w; }
      if (i < total - w && !label[i + w] && score[i + w] >= SPREAD) { label[i + w] = next; stack[top++] = i + w; }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  if (bestSize < total * 0.015) return null;

  const alpha = new Float32Array(total);
  for (let i = 0; i < total; i++) if (label[i] === best) alpha[i] = 1;

  // Soften the edge: partly magenta pixels touching the blob are blended.
  for (let pass = 0; pass < 2; pass++) {
    const grown: number[] = [];
    for (let i = 0; i < total; i++) {
      if (alpha[i] || score[i] < FRINGE) continue;
      const x = i % w;
      if (
        (x > 0 && alpha[i - 1]) ||
        (x < w - 1 && alpha[i + 1]) ||
        (i >= w && alpha[i - w]) ||
        (i < total - w && alpha[i + w])
      ) {
        grown.push(i);
      }
    }
    for (const i of grown) alpha[i] = Math.min(1, score[i] / SPREAD);
  }

  const top = new Float32Array(w).fill(-1);
  const bottom = new Float32Array(w).fill(-1);
  let left = w;
  let right = -1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (label[y * w + x] !== best) continue;
      if (top[x] < 0) top[x] = y;
      bottom[x] = y;
    }
    if (top[x] >= 0) {
      left = Math.min(left, x);
      right = x;
    }
  }
  // Columns hidden behind something in front of the product borrow the edge
  // of the nearest visible column.
  for (let x = left + 1; x <= right; x++) {
    if (top[x] < 0) {
      top[x] = top[x - 1];
      bottom[x] = bottom[x - 1];
    }
  }
  smooth(top, left, right, 4);
  smooth(bottom, left, right, 4);

  // Lighting: brightness of the magenta relative to its median.
  const samples: number[] = [];
  for (let i = 0; i < total; i += 13) {
    if (alpha[i] === 1) samples.push(Math.max(data[i * 4], data[i * 4 + 2]));
  }
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1] || 255;
  const shade = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    if (!alpha[i]) continue;
    const value = Math.max(data[i * 4], data[i * 4 + 2]) / median;
    shade[i] = Math.min(1.15, Math.max(0.35, value));
  }

  // Anything still pinkish right next to the area is light spilling from the
  // placeholder onto the frame or rim.
  const spill: number[] = [];
  const margin = 16;
  for (let x = Math.max(0, left - margin); x <= Math.min(w - 1, right + margin); x++) {
    if (top[Math.min(right, Math.max(left, x))] < 0) continue;
    const column = Math.min(right, Math.max(left, x));
    const from = Math.max(0, Math.floor(top[column]) - margin);
    const to = Math.min(h - 1, Math.ceil(bottom[column]) + margin);
    for (let y = from; y <= to; y++) {
      const i = y * w + x;
      if (!alpha[i] && score[i] > 0.05) spill.push(i);
    }
  }

  return { width: w, height: h, alpha, shade, top, bottom, left, right, spill: Int32Array.from(spill) };
}

/** Width-to-height ratio of the print area as it appears in the photo. */
export function printAreaRatio(area: PrintArea): number {
  let heights = 0;
  for (let x = area.left; x <= area.right; x++) {
    heights += area.bottom[x] - area.top[x] + 1;
  }
  const columns = area.right - area.left + 1;
  return columns / (heights / columns);
}

/**
 * Returns the scene with the map drawn into its print area. `scene` is not
 * modified.
 */
export function compositeMap(
  scene: ImageData,
  area: PrintArea,
  map: ImageData,
  shape: PrintShape,
  /** For a wrap: share of the map width that is visible (see wrapVisible). */
  visible = 0.5,
): ImageData {
  const out = new ImageData(new Uint8ClampedArray(scene.data), scene.width, scene.height);
  const { width: w, alpha, shade, top, bottom, left, right } = area;
  const span = Math.max(1, right - left);
  const mw = map.width;
  const mh = map.height;

  // Rows that can hold print pixels, with a little slack for the soft edge.
  let firstRow = area.height;
  let lastRow = 0;
  for (let x = left; x <= right; x++) {
    firstRow = Math.min(firstRow, top[x]);
    lastRow = Math.max(lastRow, bottom[x]);
  }
  firstRow = Math.max(0, Math.floor(firstRow) - 6);
  lastRow = Math.min(area.height - 1, Math.ceil(lastRow) + 6);

  for (let x = left - 6; x <= right + 6; x++) {
    if (x < 0 || x >= w) continue;
    const column = Math.min(right, Math.max(left, x));
    const t = (column - left) / span;
    // A mug shows the middle of the wrap, squeezed towards its sides the way
    // a cylinder is seen; a flat print maps straight across.
    const u =
      shape === "wrap"
        ? 0.5 + (visible * Math.asin(2 * t - 1)) / Math.PI
        : t;
    const mx = Math.min(mw - 1, Math.max(0, Math.round(u * (mw - 1))));
    const y0 = top[column];
    const height = Math.max(1, bottom[column] - y0);

    // Every placeholder pixel in the column is painted, so none is left pink
    // where the edge of the print is uneven.
    for (let y = firstRow; y <= lastRow; y++) {
      const i = y * w + x;
      const a = alpha[i];
      if (!a) continue;
      const v = Math.min(1, Math.max(0, (y - y0) / height));
      const my = Math.min(mh - 1, Math.round(v * (mh - 1)));
      const m = (my * mw + mx) * 4;
      const o = i * 4;
      const light = shade[i] || 1;
      if (a === 1) {
        out.data[o] = map.data[m] * light;
        out.data[o + 1] = map.data[m + 1] * light;
        out.data[o + 2] = map.data[m + 2] * light;
      } else {
        // Edge pixels: remove the magenta tint from the photo, then blend.
        const grey = scene.data[o + 1];
        out.data[o] = map.data[m] * light * a + grey * (1 - a);
        out.data[o + 1] = map.data[m + 1] * light * a + grey * (1 - a);
        out.data[o + 2] = map.data[m + 2] * light * a + grey * (1 - a);
      }
    }
  }
  for (const i of area.spill) {
    const o = i * 4;
    out.data[o] = out.data[o + 2] = scene.data[o + 1];
  }
  return out;
}
