import { NextResponse } from "next/server";
import { enrichPrompt } from "@/lib/adstudio/enrich";
import { providerMessage } from "@/lib/adstudio/providers";
import { parseRequest } from "@/lib/adstudio/request";

export const runtime = "nodejs";
export const maxDuration = 60;

// Returns the enriched "final prompt" for the user to review or edit.
export async function POST(request: Request) {
  const parsed = parseRequest(await request.json().catch(() => null));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!parsed.prompt) {
    return NextResponse.json({ error: "Please describe the ad you want." }, { status: 400 });
  }
  try {
    const finalPrompt = await enrichPrompt({
      prompt: parsed.prompt,
      products: parsed.products,
      settings: parsed.settings,
      hasFirstFrame: !!parsed.sourceId,
    });
    return NextResponse.json({ finalPrompt });
  } catch (error) {
    console.error("[ad-studio/enrich]", error);
    return NextResponse.json({ error: providerMessage(error) }, { status: 502 });
  }
}
