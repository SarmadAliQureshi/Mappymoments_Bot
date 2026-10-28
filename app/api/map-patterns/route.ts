import { NextResponse } from "next/server";
import { getProvider, providerMessage } from "@/lib/adstudio/providers";
import {
  PATTERN_TARGETS,
  checkSvg,
  getTarget,
  type PatternTargetId,
} from "@/lib/themes/patterns";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_PATTERNS = 3;

interface Made {
  target: PatternTargetId;
  title: string;
  svg: string;
  /** "edit" when an existing texture was changed rather than replaced. */
  mode: "edit" | "new";
}

interface Current {
  target: PatternTargetId;
  svg: string;
}

/** Reads the model's TARGET / TITLE / <svg> blocks. */
function parseReply(reply: string, fixedTarget?: PatternTargetId): Made[] {
  const made: Made[] = [];
  const blocks = reply.split(/(?=^\s*TARGET\s*:)/im).filter((block) => block.includes("<svg"));
  for (const block of blocks.length ? blocks : [reply]) {
    const target =
      fixedTarget ?? getTarget(/TARGET\s*:\s*([\w-]+)/i.exec(block)?.[1]?.toLowerCase())?.id;
    const title = /TITLE\s*:\s*(.+)/i.exec(block)?.[1]?.trim() ?? "texture";
    const mode = /MODE\s*:\s*edit/i.test(block) ? "edit" : "new";
    const svg = block.slice(block.indexOf("<svg"), block.lastIndexOf("</svg>") + 6);
    if (target && svg.length > 10) made.push({ target, title, svg, mode });
  }
  return made.slice(0, MAX_PATTERNS);
}

// Writes SVG textures for areas of the map from a description.
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const fixed = body.target === "auto" ? undefined : getTarget(body.target)?.id;
  const palette = Array.isArray(body.palette)
    ? body.palette
        .filter((item): item is { role: string; color: string } =>
          typeof item?.role === "string" && typeof item?.color === "string",
        )
        .slice(0, 40)
    : [];

  // Textures already on the map, so a follow-up can change one of them.
  const current: Current[] = [];
  for (const item of Array.isArray(body.current) ? body.current.slice(0, 6) : []) {
    const target = getTarget((item as Record<string, unknown>)?.target)?.id;
    const svg = (item as Record<string, unknown>)?.svg;
    if (!target || typeof svg !== "string") continue;
    const checked = checkSvg(svg);
    if ("svg" in checked) current.push({ target, svg: checked.svg });
  }

  if (!prompt) {
    return NextResponse.json({ error: "Describe the texture you would like." }, { status: 400 });
  }
  if (prompt.length > 500) {
    return NextResponse.json({ error: "That description is too long (max 500 characters)." }, { status: 400 });
  }
  if (body.target !== "auto" && !fixed) {
    return NextResponse.json({ error: "Choose which part of the map the texture is for." }, { status: 400 });
  }

  const system = `You design seamless, tileable SVG textures that fill areas of a printed street map (parks, water, land and so on). Roads, outlines and labels are drawn on top of your texture.

Map areas you can texture:
${PATTERN_TARGETS.map((target) => `- ${target.id}: ${target.label}`).join("\n")}

${
  fixed
    ? `Make one texture, for "${fixed}".`
    : `Pick the area or areas the request is about (at most ${MAX_PATTERNS}) and make one texture for each.`
}

Rules for every SVG:
- One square tile with width and height attributes between 96 and 512, and a matching viewBox. The tile size sets the spacing: for marks "placed at a distance", use a larger tile with only a few marks.
- It must repeat seamlessly: start with a rect covering the whole tile as the base colour, and keep every mark fully inside the tile with a margin, or repeat any mark that crosses an edge on the opposite edge.
- Use only these elements: svg, g, defs, rect, circle, ellipse, line, polyline, polygon, path, linearGradient, radialGradient, stop, clipPath, use. No text, image, filter, mask, pattern, style, script or links to anything outside the file.
- Keep it small: under 25 KB and under 150 elements. Prefer a few simple, well-drawn shapes (for trees: small stylised tree or tuft symbols built from paths, polygons or circles).
- Follow the colours and motifs in the request. Where it names none, harmonise with the current map palette below.
- Keep the texture calm and low in contrast unless asked otherwise, so roads and labels on top stay readable.

${
  current.length
    ? `Textures already on the map:
${current.map((item) => `TARGET: ${item.target}\n${item.svg}`).join("\n\n")}

Follow-up requests usually change one of these, for example "make the ship black" or "fewer trees". In that case EDIT the existing SVG instead of drawing a new one:
- Start from the existing SVG text and change only the elements or attributes the request is about.
- Copy everything else exactly as it is: the base rect and its colour, the tile size and viewBox, every other shape, colour, position and size. If the request is about a symbol, the background must not change; if it is about the background, the symbols must not change.
- Use MODE: edit for such a block, with the same TARGET.
Draw a new texture (MODE: new) only for an area that has none, or when the request clearly asks for a new or different design.

`
    : ""
}Current map palette (what each colour paints):
${palette.map((item) => `- ${item.role}: ${item.color}`).join("\n") || "- (default brown and white style)"}

Reply with one block per texture you made or changed, and nothing else:
TARGET: <area id>
MODE: <new or edit>
TITLE: <two to five words>
<svg ...>...</svg>`;

  try {
    let lastProblem = "The AI did not return a usable SVG.";
    for (let attempt = 0; attempt < 2; attempt++) {
      // Edits want precision more than invention.
      const reply = await getProvider().writeText(
        system,
        `Request: ${prompt}`,
        current.length ? 0.2 : 0.7,
      );
      const made = parseReply(reply, fixed);
      const patterns: Made[] = [];
      for (const item of made) {
        const checked = checkSvg(item.svg);
        if ("svg" in checked) patterns.push({ ...item, svg: checked.svg });
        else lastProblem = `The AI's SVG could not be used: ${checked.error}`;
      }
      if (patterns.length) return NextResponse.json({ patterns });
    }
    return NextResponse.json({ error: `${lastProblem} Please try again.` }, { status: 502 });
  } catch (error) {
    console.error("[api/map-patterns]", error);
    return NextResponse.json({ error: providerMessage(error) }, { status: 502 });
  }
}
