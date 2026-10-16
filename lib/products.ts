// The Mappy Moments product line. Sizes and prices come from
// google-merchant-products.csv; sizes are in inches.

export type PrintShape = "flat" | "wrap";

export interface ProductSize {
  id: string;
  label: string;
  /** Print width and height in inches, in the product's default orientation. */
  width: number;
  height: number;
  priceUsd: number;
}

export interface Product {
  id: string;
  name: string;
  /** flat: a rectangle facing the camera. wrap: printed around a cylinder. */
  shape: PrintShape;
  /** Flat products can be turned to landscape; a mug wrap cannot. */
  canRotate: boolean;
  /** false for the digital download: there is no object to photograph. */
  physical: boolean;
  /** Written for the image model. {finish} is replaced by the chosen finish. */
  scene: string;
  /** Real product photos from mappymoments.com; the first is the main one. */
  images: string[];
  /** Material and make, as described in the catalogue. */
  material: string;
  /** Finishes the product is sold in; the first is the default. */
  finishes?: { id: string; label: string; prompt: string }[];
  sizes: ProductSize[];
}

function sizes(rows: [number, number, number][]): ProductSize[] {
  return rows.map(([width, height, priceUsd]) => ({
    id: `${width}x${height}`,
    label: `${width}" × ${height}"`,
    width,
    height,
    priceUsd,
  }));
}

export const PRODUCTS: Product[] = [
  {
    id: "poster",
    images: ["https://mappymoments.com/images/poster-print.webp", "https://mappymoments.com/images/PrintedPoster.webp"],
    material: "premium matte or glossy paper with archival inks, edge-to-edge print",
    name: "Poster",
    shape: "flat",
    canRotate: true,
    physical: true,
    scene:
      "an unframed premium matte paper poster print with crisp square corners and no border, hanging flat against the wall",
    sizes: sizes([
      [5, 7, 9.58],
      [8, 10, 12.78],
      [8, 12, 14.38],
      [11, 14, 19.18],
      [11, 17, 23.96],
      [16, 20, 28.76],
      [18, 24, 30.36],
      [20, 30, 31.98],
      [22, 28, 54.36],
      [24, 36, 62.36],
      [28, 40, 88.28],
      [36, 48, 108.76],
    ]),
  },
  {
    id: "framed-print",
    images: ["https://mappymoments.com/images/wooden-framed.webp", "https://mappymoments.com/images/PrintedFramedPrint.webp"],
    material: "wood frame with protective acrylic glazing, ready to hang",
    name: "Framed print",
    shape: "flat",
    canRotate: true,
    physical: true,
    scene:
      "a framed print in a slim {finish} frame with clear acrylic glazing and no mat, the print filling the frame edge to edge",
    finishes: [
      { id: "natural", label: "Natural wood", prompt: "natural light oak wood" },
      { id: "black", label: "Black", prompt: "matte black wood" },
      { id: "white", label: "White", prompt: "matte white wood" },
    ],
    sizes: sizes([
      [8, 10, 135.98],
      [11, 14, 155.98],
      [16, 16, 167.98],
      [16, 20, 194.38],
      [24, 36, 311.98],
    ]),
  },
  {
    id: "mug",
    images: ["https://mappymoments.com/images/mug-print.webp", "https://mappymoments.com/images/PrintedMug.webp"],
    material: "white glossy ceramic mug with a full-wrap edge-to-edge print",
    name: "Mug",
    shape: "wrap",
    canRotate: false,
    physical: true,
    scene:
      "a white glossy ceramic mug with an edge-to-edge full-wrap print: the print covers the entire outer wall of the mug, from the rim all the way down to the base and right across to the left and right outline of the mug, leaving no white band or margin anywhere on the body. Only the handle, the inside of the mug and the thin top edge of the rim are white. The handle is out to the right side so the printed front faces the camera",
    // The CSV lists mug prints as height x width.
    sizes: [
      { id: "3.2x7.2", label: '3.20" × 7.20"', width: 7.2, height: 3.2, priceUsd: 27.18 },
      { id: "3.15x8.46", label: '3.15" × 8.46"', width: 8.46, height: 3.15, priceUsd: 27.18 },
      { id: "3.8x8", label: '3.80" × 8.00"', width: 8, height: 3.8, priceUsd: 27.18 },
    ],
  },
  {
    id: "wood-print",
    images: ["https://mappymoments.com/images/wood-print.webp", "https://mappymoments.com/images/PrintedWoodPrint.webp"],
    material: "0.5 inch thick maple wood panel, natural grain showing through",
    name: "Wood print",
    shape: "flat",
    canRotate: true,
    physical: true,
    scene:
      "a print on a half-inch thick maple wood panel with {finish} and no frame, hanging flat against the wall",
    finishes: [
      { id: "natural", label: "Natural wood base", prompt: "visible natural wood edges" },
      { id: "white", label: "White base", prompt: "a white-primed face and natural wood edges" },
    ],
    sizes: sizes([
      [5, 7, 43.98],
      [8, 10, 55.98],
      [8, 12, 63.98],
      [11, 14, 79.98],
      [12, 18, 95.98],
      [16, 20, 127.98],
      [16, 24, 127.98],
      [20, 30, 215.98],
      [24, 36, 231.98],
    ]),
  },
  {
    id: "metal-print",
    images: ["https://mappymoments.com/images/metal-print.webp", "https://mappymoments.com/images/PrintedMetalPrint.webp"],
    material: "ChromaLuxe aluminium with a high-gloss finish",
    name: "Metal print",
    shape: "flat",
    canRotate: true,
    physical: true,
    scene:
      "a frameless print on a thin high-gloss aluminium panel that floats slightly off the wall, with sharp square corners",
    sizes: sizes([
      [8, 10, 83.18],
      [8, 12, 95.98],
      [11, 14, 127.98],
      [12, 18, 140.78],
      [16, 20, 207.98],
      [16, 24, 243.18],
      [20, 30, 268.78],
      [24, 36, 294.38],
    ]),
  },
  {
    id: "digital",
    images: ["https://mappymoments.com/images/digital-laptop-view.webp"],
    material: "high-resolution printable file, shown on a screen",
    name: "Digital download",
    shape: "flat",
    canRotate: true,
    physical: false,
    scene: "",
    sizes: sizes([
      [5, 7, 15],
      [8, 8, 15],
      [8, 10, 15],
      [8, 12, 15],
      [11, 14, 15],
      [12, 12, 15],
      [12, 16, 15],
      [12, 18, 15],
      [16, 16, 15],
      [16, 20, 15],
      [16, 24, 15],
      [18, 24, 15],
      [20, 30, 15],
      [22, 28, 15],
      [24, 36, 15],
      [36, 48, 15],
    ]),
  },
];

export const DEFAULT_PRODUCT_ID = "framed-print";

export function getProduct(id: unknown): Product | null {
  return PRODUCTS.find((product) => product.id === id) ?? null;
}

export function getSize(product: Product, id: unknown): ProductSize {
  return product.sizes.find((size) => size.id === id) ?? product.sizes[0];
}

/** Print width and height in inches after applying the orientation. */
export function printDimensions(
  product: Product,
  size: ProductSize,
  landscape: boolean,
): { width: number; height: number } {
  if (product.canRotate && landscape) {
    return { width: size.height, height: size.width };
  }
  return { width: size.width, height: size.height };
}

export function formatPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(2)}`;
}
