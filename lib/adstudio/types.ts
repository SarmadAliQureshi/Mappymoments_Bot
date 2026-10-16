// Shared between the Ad Studio page and its API routes.

export type AdType = "image" | "video";
export type AdStatus = "queued" | "generating" | "done" | "failed";
export type AdAspect = "1:1" | "4:5" | "9:16" | "16:9";

export const ASPECTS: { value: AdAspect; label: string; video: boolean }[] = [
  { value: "1:1", label: "Feed 1:1", video: false },
  { value: "4:5", label: "Portrait 4:5", video: false },
  { value: "9:16", label: "Story/Reel 9:16", video: true },
  { value: "16:9", label: "Landscape 16:9", video: true },
];

// The video model makes clips of these lengths only.
export const DURATIONS = [4, 6, 8] as const;
export type AdDuration = (typeof DURATIONS)[number];

export const MOTION_PRESETS = [
  {
    id: "spin",
    label: "360° spin",
    prompt:
      "the product turns slowly and smoothly through one full 360 degree rotation on the spot while the camera stays still",
  },
  {
    id: "zoom",
    label: "Slow zoom",
    prompt: "the camera pushes in very slowly and steadily towards the product",
  },
  {
    id: "pan",
    label: "Pan",
    prompt: "the camera glides slowly sideways across the scene, keeping the product in frame",
  },
  {
    id: "unboxing",
    label: "Unboxing / reveal",
    prompt:
      "the product starts out hidden inside its closed packaging and is revealed by the end as the packaging is opened",
  },
  {
    id: "lifestyle",
    label: "Lifestyle scene",
    prompt:
      "a calm lived-in moment: light shifts gently, leaves stir, steam or fabric moves slightly, while the product stays still and in focus",
  },
] as const;
export type MotionId = (typeof MOTION_PRESETS)[number]["id"];

export const AD_STYLES = [
  {
    id: "studio",
    label: "Studio clean",
    prompt: "clean studio product shot on a seamless neutral backdrop with soft even light",
  },
  {
    id: "luxury",
    label: "Elegant / luxury",
    prompt: "elegant, luxurious styling with refined materials, brass accents and rich soft shadows",
  },
  {
    id: "cozy",
    label: "Cozy home",
    prompt: "a cozy lived-in home with linen, warm oak wood and gentle daylight",
  },
  {
    id: "wall",
    label: "Lifestyle wall mockup",
    prompt: "shown in place in a tastefully furnished room, at realistic scale",
  },
  {
    id: "gift",
    label: "Seasonal / gift",
    prompt: "styled as a thoughtful gift, with ribbon, kraft paper wrapping and subtle seasonal touches",
  },
] as const;
export type AdStyleId = (typeof AD_STYLES)[number]["id"];

/** A product the ad features, with the variant chosen for it. */
export interface AdProductChoice {
  productId: string;
  sizeId: string;
  finishId: string;
}

export interface AdSettings {
  type: AdType;
  aspect: AdAspect;
  styleId: AdStyleId | null;
  /** Video only. */
  duration: AdDuration;
  motionId: MotionId;
}

export interface AdEntry {
  id: string;
  type: AdType;
  status: AdStatus;
  error?: string;
  /** What the user typed. */
  prompt: string;
  /** What was sent to the model. */
  finalPrompt: string;
  products: AdProductChoice[];
  settings: AdSettings;
  createdAt: string;
  /** Stored media file name once done. */
  file?: string;
  /** Uploaded reference images kept so the ad can be regenerated. */
  refFiles: string[];
  /** Library image used as the video's first frame. */
  sourceId?: string;
  /** Provider's job handle for a video in progress. */
  operation?: string;
}

export const MAX_EXTRA_REFS = 3;
export const MAX_VARIATIONS = 4;
