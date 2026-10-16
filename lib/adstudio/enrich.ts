// Turns the user's short ad idea into the full prompt sent to the model, by
// adding the chosen products' details and the brand direction.

import { BRAND_DIRECTION } from "@/lib/brand";
import { getProvider } from "@/lib/adstudio/providers";
import {
  AD_STYLES,
  MOTION_PRESETS,
  type AdProductChoice,
  type AdSettings,
} from "@/lib/adstudio/types";
import { getProduct, getSize } from "@/lib/products";

/** One line per product: name, size, finish and material. */
export function describeProducts(choices: AdProductChoice[]): string {
  return choices
    .map((choice) => {
      const product = getProduct(choice.productId);
      if (!product) return null;
      const size = getSize(product, choice.sizeId);
      const finish = product.finishes?.find((item) => item.id === choice.finishId);
      return `- Mappy Moments ${product.name}, ${size.label}${
        finish ? `, ${finish.label.toLowerCase()}` : ""
      }: ${product.material}.`;
    })
    .filter(Boolean)
    .join("\n");
}

export async function enrichPrompt(input: {
  prompt: string;
  products: AdProductChoice[];
  settings: AdSettings;
  hasFirstFrame: boolean;
}): Promise<string> {
  const { prompt, products, settings } = input;
  const video = settings.type === "video";
  const style = AD_STYLES.find((item) => item.id === settings.styleId);
  const motion = MOTION_PRESETS.find((item) => item.id === settings.motionId);

  // A video made from catalogue photos needs its own opening still, and a
  // story such as an unboxing also needs a different closing still.
  const storyboard = video && !input.hasFirstFrame;

  const shared = `- Keep the user's idea and everything they name (setting, colours, props, motion). Their wording wins over the brand direction where the two differ.
- Wherever the product is visible it must look exactly as it does in the reference photos: the same shape, the same printed map artwork, the same colours and the same frame or base material. Say so explicitly, and never describe a new or different map design.
- Name each product with its size, finish and material from the product details.
- Apply the brand direction to everything the user left unsaid.
${style ? `- Style to follow: ${style.prompt}.\n` : ""}- No text, logos, watermarks or captions.`;

  const brand = `Brand direction:\n${BRAND_DIRECTION}`;
  const intro = `You write the final prompt for an AI ${video ? "video" : "image"} generator that is making an advert for Mappy Moments, a brand of personalised map keepsakes.`;

  let system: string;
  if (storyboard) {
    system = `${intro}

The video is made from two still images that are generated first, from reference photos of the real product: an opening frame and, when the story needs one, a closing frame. The video model then animates from the opening frame to the closing frame. You write all three descriptions.

First work out the story: what is on screen in the very first instant, and what is on screen at the very end.
- Unboxing, unwrapping, opening or any reveal: in the OPENING FRAME the packaging is completely closed (lid on, ribbon tied) and the product is not visible at all, not even partly. In the CLOSING FRAME the same box is open in the same spot with the lid set down beside it and the product revealed inside. The VIDEO describes the opening in between: a pair of hands enters, unties the ribbon and lifts the lid off, folds the tissue back to reveal the product, then leaves the frame. Hands are allowed for this; show no faces.
- Any other story where the scene changes between start and end: describe the two states the same way.
- If the product is visible and the scene stays the same throughout (a spin, a slow zoom, a pan, a calm lifestyle moment), the CLOSING FRAME is the single word SAME, and the motion is: ${motion?.prompt}.

Rules:
${shared}
- The VIDEO is one continuous ${settings.duration} second shot with no cuts; the camera barely moves when the story is an action such as an unboxing. Keep the product sharp and undistorted once it is visible.
- Both frames are photographs of the same set from the same camera position, with the same surface, props and light.
- No people beyond the hands described above, unless the user asks for them.

Output exactly these three labelled parts and nothing else, each one paragraph of at most 90 words:
VIDEO: ...
OPENING FRAME: ...
CLOSING FRAME: ...

${brand}`;
  } else {
    system = `${intro}

${
  video
    ? "The generator is given a still image as the first frame of the video, showing the real product; the video must start from exactly that picture."
    : "The generator is given reference photos of the real product alongside your prompt."
}

Rules:
${shared}
${
  video
    ? `- Describe one continuous ${settings.duration} second shot with no cuts. Motion: ${motion?.prompt}. Keep the product sharp and undistorted throughout.\n`
    : "- Describe a single photograph, composed for the given aspect ratio.\n"
}- No people unless the user asks for them.
- Output only the prompt, as one paragraph of at most 150 words.

${brand}`;
  }

  const user = `User's idea: ${prompt}

Product details:
${describeProducts(products) || "- (no catalogue product chosen; follow the reference images)"}

Aspect ratio: ${settings.aspect}`;

  return getProvider().writeText(system, user);
}

export interface VideoScript {
  /** What happens in the video. */
  video: string;
  /** The first still; undefined when the prompt has no labelled parts. */
  opening?: string;
  /** The last still, when it differs from the first. */
  closing?: string;
}

/**
 * Splits a final prompt written as VIDEO / OPENING FRAME / CLOSING FRAME.
 * Text without those labels (for example edited by hand) is all video prompt.
 */
export function parseVideoScript(text: string): VideoScript {
  const part = (label: string) =>
    new RegExp(
      `${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:VIDEO|OPENING FRAME|CLOSING FRAME)\\s*:|$)`,
      "i",
    )
      .exec(text)?.[1]
      .trim();
  const video = part("VIDEO");
  const opening = part("OPENING FRAME");
  const closing = part("CLOSING FRAME");
  if (!video || !opening) return { video: text.trim() };
  return {
    video,
    opening,
    closing: closing && !/^same\W*$/i.test(closing) ? closing : undefined,
  };
}
