// Validates what the Ad Studio page sends to its API routes.

import {
  AD_STYLES,
  ASPECTS,
  DURATIONS,
  MOTION_PRESETS,
  type AdProductChoice,
  type AdSettings,
} from "@/lib/adstudio/types";
import { getProduct, getSize } from "@/lib/products";

export interface AdRequest {
  prompt: string;
  products: AdProductChoice[];
  settings: AdSettings;
  sourceId?: string;
}

const MAX_PROMPT = 2000;

export function parseRequest(body: unknown): AdRequest | { error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  const raw = (input.settings ?? {}) as Record<string, unknown>;

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length > MAX_PROMPT) {
    return { error: `The prompt is too long (max ${MAX_PROMPT} characters).` };
  }

  const products: AdProductChoice[] = [];
  for (const item of Array.isArray(input.products) ? input.products.slice(0, 6) : []) {
    const choice = (item ?? {}) as Record<string, unknown>;
    const product = getProduct(choice.productId);
    if (!product) return { error: "One of the chosen products is not in the catalogue." };
    products.push({
      productId: product.id,
      sizeId: getSize(product, choice.sizeId).id,
      finishId:
        product.finishes?.find((finish) => finish.id === choice.finishId)?.id ??
        product.finishes?.[0].id ??
        "",
    });
  }

  const type = raw.type === "video" ? "video" : "image";
  const aspect = ASPECTS.find((item) => item.value === raw.aspect) ?? ASPECTS[0];
  if (type === "video" && !aspect.video) {
    return { error: "Video can only be made in Story/Reel (9:16) or Landscape (16:9)." };
  }

  return {
    prompt,
    products,
    settings: {
      type,
      aspect: aspect.value,
      styleId: AD_STYLES.find((item) => item.id === raw.styleId)?.id ?? null,
      duration: DURATIONS.find((item) => item === raw.duration) ?? DURATIONS[0],
      motionId:
        MOTION_PRESETS.find((item) => item.id === raw.motionId)?.id ??
        MOTION_PRESETS[0].id,
    },
    sourceId: typeof input.sourceId === "string" ? input.sourceId : undefined,
  };
}
