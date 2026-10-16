// The only file that talks to a generation provider. To use another provider,
// add an object with the same methods and return it from getProvider().

import { ApiError, GenerateVideosOperation, GoogleGenAI } from "@google/genai";
import type { AdAspect, AdDuration } from "@/lib/adstudio/types";

export interface MediaData {
  data: Buffer;
  mimeType: string;
}

export interface VideoStatus {
  done: boolean;
  video?: MediaData;
  error?: string;
}

export interface AdProvider {
  /** Rewrites text with a language model. */
  writeText(system: string, user: string): Promise<string>;
  /** One image that features the products shown in the reference images. */
  generateImage(input: {
    prompt: string;
    aspect: AdAspect;
    references: MediaData[];
  }): Promise<MediaData>;
  /** Starts a video from a first frame; returns a handle to check later. */
  startVideo(input: {
    prompt: string;
    aspect: AdAspect;
    duration: AdDuration;
    firstFrame: MediaData;
    /** When given, the video ends on this picture. */
    lastFrame?: MediaData;
  }): Promise<string>;
  checkVideo(operation: string): Promise<VideoStatus>;
}

const TEXT_MODELS = (
  process.env.GEMINI_TEXT_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash-lite"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
const VIDEO_MODEL =
  process.env.GEMINI_VIDEO_MODEL ?? "veo-3.1-fast-generate-preview";

/** The provider's own message, without the JSON wrapping the SDK adds. */
export function providerMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      return JSON.parse(error.message)?.error?.message ?? error.message;
    } catch {
      return error.message;
    }
  }
  if (error instanceof Error && error.message !== "fetch failed") {
    return error.message;
  }
  return "The generation service could not be reached. Please try again.";
}

function gemini(): AdProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local and restart the server.",
    );
  }
  const client = new GoogleGenAI({ apiKey });

  return {
    async writeText(system, user) {
      let lastError: unknown;
      for (const model of TEXT_MODELS) {
        try {
          const response = await client.models.generateContent({
            model,
            contents: user,
            config: {
              systemInstruction: system,
              temperature: 0.7,
              httpOptions: { timeout: 30_000 },
            },
          });
          const text = response.text?.trim();
          if (text) return text;
          lastError = new Error("The prompt writer returned nothing.");
        } catch (error) {
          // A bad key or request fails on every model, so stop early.
          if (error instanceof ApiError && error.status < 500 && error.status !== 404) {
            throw error;
          }
          lastError = error;
        }
      }
      throw lastError;
    },

    async generateImage({ prompt, aspect, references }) {
      const response = await client.models.generateContent({
        model: IMAGE_MODEL,
        contents: [
          ...references.map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data.toString("base64"),
            },
          })),
          { text: prompt },
        ],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: aspect },
          httpOptions: { timeout: 150_000 },
        },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find((part) => part.inlineData?.data)?.inlineData;
      if (!image?.data) {
        const reason = response.candidates?.[0]?.finishReason;
        throw new Error(
          `The image model did not return an image${reason ? ` (${reason})` : ""}.`,
        );
      }
      return {
        data: Buffer.from(image.data, "base64"),
        mimeType: image.mimeType ?? "image/png",
      };
    },

    async startVideo({ prompt, aspect, duration, firstFrame, lastFrame }) {
      const operation = await client.models.generateVideos({
        model: VIDEO_MODEL,
        prompt,
        image: {
          imageBytes: firstFrame.data.toString("base64"),
          mimeType: firstFrame.mimeType,
        },
        config: {
          aspectRatio: aspect,
          // The model only joins a first and last frame in 8 second clips.
          durationSeconds: lastFrame ? 8 : duration,
          numberOfVideos: 1,
          resolution: "720p",
          ...(lastFrame
            ? {
                lastFrame: {
                  imageBytes: lastFrame.data.toString("base64"),
                  mimeType: lastFrame.mimeType,
                },
              }
            : {}),
        },
      });
      if (!operation.name) {
        throw new Error("The video model did not accept the request.");
      }
      return operation.name;
    },

    async checkVideo(name) {
      const handle = new GenerateVideosOperation();
      handle.name = name;
      const operation = await client.operations.getVideosOperation({
        operation: handle,
      });
      if (!operation.done) return { done: false };
      if (operation.error) {
        return {
          done: true,
          error: String(operation.error.message ?? "The video could not be made."),
        };
      }
      const uri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) {
        const reasons = operation.response?.raiMediaFilteredReasons?.join(" ");
        return {
          done: true,
          error: reasons || "The video model returned no video.",
        };
      }
      const download = await fetch(uri, { headers: { "x-goog-api-key": apiKey } });
      if (!download.ok) {
        return {
          done: true,
          error: `The finished video could not be downloaded (${download.status}).`,
        };
      }
      return {
        done: true,
        video: {
          data: Buffer.from(await download.arrayBuffer()),
          mimeType: "video/mp4",
        },
      };
    },
  };
}

export function getProvider(): AdProvider {
  return gemini();
}
