import { NextResponse } from "next/server";
import { ApiError, GoogleGenAI } from "@google/genai";
import {
  BRAND_SYSTEM_PROMPT,
  MAX_PROMPT_LENGTH,
  type AspectRatio,
  type GenerateResult,
} from "@/lib/brand";
import {
  getProduct,
  getSize,
  printDimensions,
  type Product,
} from "@/lib/products";

export const runtime = "nodejs";
export const maxDuration = 180;

// Tried in order: if the first is overloaded or unreachable, the next is used.
const TEXT_MODELS = (
  process.env.GEMINI_TEXT_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash-lite"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

const ASPECT_RATIOS: Record<AspectRatio, string> = {
  square: "1:1",
  landscape: "3:2",
  portrait: "2:3",
};

// Appended to every image prompt so the placeholder survives whatever the
// enhancer wrote. The browser replaces it with the real map afterwards.
const PLACEHOLDER_RULES: Record<Product["shape"], string> = {
  flat: "Strict requirement: the product's entire print area is one flat, perfectly uniform, solid pure magenta colour (hex #FF00FF), edge to edge, with no map, picture, text, pattern, gradient or reflection drawn on it. Soft light and shadow may fall across it naturally. The product is in sharp focus, faces the camera straight on with no tilt, and its whole print area is visible with nothing overlapping it. Nothing else in the image is magenta, pink or purple. The image contains no text.",
  wrap: "Strict requirement: the whole outer wall of the mug is solid pure magenta (hex #FF00FF), as if the mug body itself were magenta ceramic: the magenta runs from the rim down to the base and all the way to the left and right silhouette of the mug, with no white band, border, panel or margin on the body. It is not a rectangular label. Only the handle, the interior and the thin rim edge are white. No map, picture, text, pattern or gradient is drawn on the magenta; soft light and shadow may fall across it naturally. The mug is in sharp focus, seen level from the front, with nothing overlapping its body. Nothing else in the image is magenta, pink or purple. The image contains no text.",
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// The SDK surfaces the raw JSON error body as the message; pull out the
// human-readable part.
function apiErrorMessage(error: ApiError): string {
  try {
    const parsed = JSON.parse(error.message);
    return parsed?.error?.message ?? error.message;
  } catch {
    return error.message;
  }
}

function failureResponse(error: unknown) {
  console.error("[api/generate]", error);

  if (error instanceof ApiError) {
    const status =
      typeof error.status === "number" && error.status >= 400
        ? error.status
        : 502;
    const message = apiErrorMessage(error);
    if (status === 429 && message.includes("limit: 0")) {
      return errorResponse(
        `Your Gemini API key has no free quota for the image model (${IMAGE_MODEL}). Enable billing for the key's project in Google AI Studio, then try again.`,
        429,
      );
    }
    return errorResponse(message, status);
  }
  return errorResponse(
    error instanceof Error && error.message !== "fetch failed"
      ? error.message
      : "Something went wrong while generating the image.",
    500,
  );
}

// Gemini returns 503 during demand spikes; these usually clear in seconds.
async function withRetry<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const retryable = error instanceof ApiError && error.status === 503;
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

// "black frame" typed in the scene wins over the finish picker.
function finishFromPrompt(product: Product, prompt: string): string | null {
  if (!product.finishes) return null;
  const text = prompt.toLowerCase();
  const noun = product.id === "framed-print" ? "frame" : "base";
  for (const option of product.finishes) {
    const word = option.id === "natural" ? "(natural|oak|wood|wooden)" : option.id;
    if (new RegExp(`\\b${word}\\b[\\w\\s-]{0,20}\\b${noun}`).test(text)) {
      return option.id;
    }
  }
  return null;
}

function describeProduct(
  product: Product,
  sizeId: unknown,
  landscape: boolean,
  finishId: unknown,
): string {
  const finish =
    product.finishes?.find((option) => option.id === finishId) ??
    product.finishes?.[0];
  const size = getSize(product, sizeId);
  const { width, height } = printDimensions(product, size, landscape);
  const proportions =
    product.shape === "wrap"
      ? `The printed band is ${height} inches tall and wraps ${width} inches around the mug.`
      : `The print is ${width} inches wide by ${height} inches tall (${
          width === height ? "square" : width > height ? "landscape" : "portrait"
        }); keep exactly these proportions.`;
  return `${product.scene.replace("{finish}", finish?.prompt ?? "")}. ${proportions}`;
}

async function enhancePrompt(
  client: GoogleGenAI,
  prompt: string,
  variant: boolean,
  productNote: string,
): Promise<string> {
  let userMessage = `Scene requested by the user (every colour, material, finish and setting named here must appear exactly as written, and takes priority over the brand palette): ${prompt}\n\nProduct: ${productNote}`;
  if (variant) {
    userMessage +=
      "\n\nCreate a fresh variant: keep the same product and brand direction, but change the setting details, composition and supporting props.";
  }

  let lastError: unknown;
  for (const model of TEXT_MODELS) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: userMessage,
        config: {
          systemInstruction: BRAND_SYSTEM_PROMPT,
          temperature: variant ? 1 : 0.7,
          httpOptions: { timeout: 30_000 },
        },
      });
      const enhanced = response.text?.trim();
      if (enhanced) return enhanced;
      lastError = new Error("The prompt enhancer returned an empty response.");
    } catch (error) {
      // A bad key or bad request will fail on every model, so stop early.
      if (error instanceof ApiError && error.status < 500 && error.status !== 404) {
        throw error;
      }
      lastError = error;
      console.warn(`[api/generate] text model ${model} failed, trying next`);
    }
  }
  throw lastError;
}

async function generateImage(
  client: GoogleGenAI,
  prompt: string,
  aspect: AspectRatio,
  shape: Product["shape"],
): Promise<string> {
  const response = await client.models.generateContent({
    model: IMAGE_MODEL,
    contents: `${prompt}\n\n${PLACEHOLDER_RULES[shape]}`,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: ASPECT_RATIOS[aspect] },
      httpOptions: { timeout: 150_000 },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const reason = response.candidates?.[0]?.finishReason;
    throw new Error(
      `The image model did not return an image${reason ? ` (${reason})` : ""}. Try rewording the prompt.`,
    );
  }
  return `data:${image.mimeType ?? "image/png"};base64,${image.data}`;
}

// Generates the product photo only. The map is drawn in the browser.
export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return errorResponse(
      "GEMINI_API_KEY is not set. Add it to .env.local and restart the server.",
      500,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const { prompt, aspect, variant, product, size, landscape, finish } = (body ??
    {}) as Record<string, unknown>;

  const chosen = getProduct(product);
  if (!chosen || !chosen.physical) {
    return errorResponse("Please choose a product to photograph.", 400);
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return errorResponse("Please describe the scene you would like.", 400);
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse(
      `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters).`,
      400,
    );
  }

  const safeAspect: AspectRatio =
    aspect === "landscape" || aspect === "portrait" ? aspect : "square";
  const originalPrompt = prompt.trim();

  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const enhancedPrompt = await enhancePrompt(
      client,
      originalPrompt,
      variant === true,
      describeProduct(
        chosen,
        size,
        landscape === true,
        finishFromPrompt(chosen, originalPrompt) ?? finish,
      ),
    );
    const imageUrl = await withRetry(() =>
      generateImage(client, enhancedPrompt, safeAspect, chosen.shape),
    );

    const result: GenerateResult = {
      imageUrl,
      originalPrompt,
      enhancedPrompt,
      aspect: safeAspect,
    };
    return NextResponse.json(result);
  } catch (error) {
    return failureResponse(error);
  }
}
