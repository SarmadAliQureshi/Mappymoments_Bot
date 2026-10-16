import { NextResponse } from "next/server";
import { getProvider, providerMessage } from "@/lib/adstudio/providers";
import {
  BASE_COLORS,
  applyMapping,
  describeTone,
  normalizeMapping,
  validateStyle,
  type ColorMapping,
} from "@/lib/themes/theme";

export const runtime = "nodejs";
export const maxDuration = 120;

const ATTEMPTS = 2;

function colorList(current?: ColorMapping): string {
  return BASE_COLORS.map((entry) => {
    const now = current?.[entry.color];
    return `"${entry.color}" (${describeTone(entry.color)}) — ${entry.roles.join(", ")}; ${
      entry.visibleLayers.length
        ? `used by ${entry.visibleLayers.length} visible layer(s)`
        : "only on hidden layers"
    }${now && now !== entry.color ? `; currently recoloured to ${now}` : ""}`;
  }).join("\n");
}

const RULES = `Rules:
- Map by role, not at random. Each base colour becomes a colour that plays the same part in the new palette, with about the same lightness and saturation relative to the others, so that road hierarchy (main roads darker and stronger than streets), land against water, and mountain shading all stay as readable as in the base.
- The base is mostly white land with one dark tone for line work. Keep that balance: pale colours stay pale tints, dark colours stay dark.
- When the user names two colours, one is the dominant tone and the other the accent, and near-neutral tints fill the rest. Do not make everything fully saturated.
- Labels must stay legible against what is behind them, and halos must contrast with their label colour.
- Give every base colour a new value, including the ones only on hidden layers, so the theme stays consistent if those layers are switched on.
- New colours are always written as #rrggbb.`;

const FORMAT = `Reply with a JSON object and nothing else, in this shape:
{"name": "two to four words naming the theme by its colours", "colors": {"<base colour exactly as written>": "#rrggbb", ...}}
The keys of "colors" must be the base colour strings exactly as they are written in the list.`;

// Asks the AI for a mapping of old colour -> new colour, then applies it to
// the base style in code so that nothing but colours can change.
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const refine = typeof body.refine === "string" ? body.refine.trim() : "";
  const variation = body.variation === true;
  const current = body.current ? normalizeMapping(body.current).mapping : undefined;

  if (!prompt) {
    return NextResponse.json({ error: "Describe the colours you would like." }, { status: 400 });
  }
  if (prompt.length > 500 || refine.length > 500) {
    return NextResponse.json({ error: "That description is too long (max 500 characters)." }, { status: 400 });
  }
  if (refine && !current) {
    return NextResponse.json({ error: "There is no theme to refine yet." }, { status: 400 });
  }

  const system = `You are a cartographic colour designer. You recolour an existing street-map style by replacing its colours one for one.

${RULES}

${FORMAT}`;

  const user = refine
    ? `The map was themed from this request: "${prompt}".

Base colours, what each one paints, and what it is recoloured to now:
${colorList(current)}

Change requested: "${refine}"

Apply only that change. Every colour it does not concern keeps its current value exactly. Return the full mapping.`
    : `Request: "${prompt}"

Base colours and what each one paints:
${colorList()}
${
  variation && current
    ? `\nThis is a second take. The previous answer was:\n${JSON.stringify(current)}\nGive a noticeably different interpretation of the same request (different shades or a different choice of dominant and accent).`
    : ""
}`;

  let lastProblem = "The AI did not return a usable colour mapping.";
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const reply = await getProvider().writeText(system, user);
      let parsed: { name?: unknown; colors?: unknown };
      try {
        parsed = JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
      } catch {
        lastProblem = "The AI's answer was not valid JSON.";
        continue;
      }

      const { mapping, missing } = normalizeMapping(parsed.colors);
      // A refinement may leave colours out: those keep their current value.
      if (refine && current) {
        for (const color of missing) mapping[color] = current[color];
      } else if (missing.length > BASE_COLORS.length / 4) {
        lastProblem = `The AI left out ${missing.length} of ${BASE_COLORS.length} colours.`;
        continue;
      }

      const problems = validateStyle(applyMapping(mapping));
      if (problems.length) {
        lastProblem = `The generated style failed validation: ${problems[0]}`;
        continue;
      }

      return NextResponse.json({
        name:
          typeof parsed.name === "string" && parsed.name.trim()
            ? parsed.name.trim().slice(0, 60)
            : "Custom theme",
        mapping,
      });
    }
    return NextResponse.json({ error: `${lastProblem} Please try again.` }, { status: 502 });
  } catch (error) {
    console.error("[api/color-themes]", error);
    return NextResponse.json({ error: providerMessage(error) }, { status: 502 });
  }
}
