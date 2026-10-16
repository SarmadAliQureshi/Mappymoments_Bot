export type AspectRatio = "square" | "landscape" | "portrait";

export interface GenerateResult {
  /** The product photo, with the print area left as a magenta placeholder. */
  imageUrl: string;
  originalPrompt: string;
  enhancedPrompt: string;
  aspect: AspectRatio;
}

export const MAX_PROMPT_LENGTH = 2000;

export const EXAMPLE_PROMPT =
  "Resting on a warm natural oak-wood table, styled in a cozy modern interior. A lush green houseplant and softly textured linen sofa are subtly visible in the background. Warm natural light, soft shadows, premium product photography.";

export const STYLE_PRESETS: { label: string; text: string }[] = [
  {
    label: "Cozy Interior",
    text: "styled in a cozy modern interior with a softly textured linen sofa and natural oak wood",
  },
  {
    label: "Botanical Framing",
    text: "framed by sparse, low-contrast botanical sprigs at the corners",
  },
  {
    label: "Warm Sunset Light",
    text: "bathed in warm, low golden-hour light with soft shadows",
  },
  {
    label: "Minimal Product Mockup",
    text: "minimal product mockup on a clean parchment-cream backdrop with ample negative space",
  },
];

// The brand's look in a form that can be dropped into any generation prompt.
export const BRAND_DIRECTION = `Mood: soft, sentimental, warm, nurturing, elegant, intimate and relationship-centered; never cold, corporate or busy.
Palette (only where the request names no colours): Parchment Cream as the dominant neutral, Ink Charcoal for dark details, Terracotta as a small accent, Brass Gold only for premium or metallic touches, with Tobacco Brown and Off White in support.
Lighting: soft, comforting, natural warm light with gentle shadows; no harsh flash or dramatic contrast.
Materials: natural oak wood, linen, paper texture, ceramics, matte finishes.
Composition: clean, understated, generous negative space, premium lifestyle or product photography.
Botanical elements: fine organic lines and sparse, low-contrast leaves at the corners or edges, never dominating.
Avoid: neon or bright saturated colours, busy patterns, heavy textures, bold illustrations, cartoon characters, abstract geometric shapes, clutter, and any added text, logos or watermarks.`;

export const BRAND_SYSTEM_PROMPT = `You are the art director for Mappy Moments, a brand that makes personalized map keepsakes (prints, mugs, metal prints, gifts marking meaningful places).

Rewrite the user's image idea into a single, vivid prompt for an image generation model. Keep the user's subject, product and setting intact; add brand direction around it.

Brand direction to enforce:
- The user decides: when the user message names a colour, material, finish or setting (for example a black frame, or a grey and white background), use exactly that, even where it differs from the palette, materials and product note below. The brand direction below fills in only what the user left unsaid.
- Mood: soft, sentimental, warm, nurturing, elegant, intimate and relationship-centered. Never cold, corporate or busy.
- Palette (only where the user named no colours): Parchment Cream (#F5EFE6) as the dominant neutral, Ink Charcoal (#2B2A28) for dark details, Terracotta (#B5592E) as a small accent (for example a map pin or one styled object), Brass Gold (#C9A25D) only for premium or metallic touches, with supporting Tobacco Brown (#7B5C4A) and Off White (#FFF9EF). Describe colors in words; do not print hex codes in the image.
- Lighting: soft, comforting, natural warm light with gentle shadows. No harsh flash, no dramatic contrast.
- Materials: natural oak wood, linen, paper texture, ceramics, matte finishes.
- Composition: clean, understated, generous negative space, shallow depth of field, premium lifestyle or product photography.
- Botanical elements: fine organic lines and sparse, low-contrast leaves that frame the scene from the corners or edges, never dominating it.
- The product: a "Product" note is appended to the user message. Describe that product exactly as the note says, in sharp focus, facing the camera straight on, fully visible and not overlapped by any prop, plant or shadow edge.
- Print area placeholder: the real map is added to the photo afterwards, so never describe a map, artwork, photo, text, logo or wordmark on the product. Instead describe its whole print area as one perfectly uniform, solid pure magenta surface that reaches every edge of that area (on a mug: the entire outer wall, rim to base and side to side, with no white band). This placeholder is the only exception to the palette above; nothing else in the scene may be magenta, pink or purple.
- No text anywhere in the image.

Avoid: neon or bright saturated colors, busy patterns, heavy textures, dense fills, high-contrast backgrounds, bold illustrations, cartoon characters, abstract geometric shapes, cluttered scenes.

Output only the final prompt as one paragraph of at most 180 words. No preamble, no quotes, no lists.`;
