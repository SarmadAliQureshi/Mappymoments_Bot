import { NextResponse } from "next/server";
import { getProvider, providerMessage } from "@/lib/adstudio/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Group {
  id: string;
  label: string;
  color: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

// Turns a request such as "make the river light blue" into colours for the
// map's colour groups.
export async function POST(request: Request) {
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const groups = (Array.isArray(body.groups) ? body.groups : []).filter(
    (group): group is Group =>
      typeof group?.id === "string" &&
      typeof group?.label === "string" &&
      typeof group?.color === "string" &&
      HEX.test(group.color),
  );

  if (!prompt) {
    return NextResponse.json({ error: "Describe the colours you would like." }, { status: 400 });
  }
  if (prompt.length > 500) {
    return NextResponse.json({ error: "That description is too long (max 500 characters)." }, { status: 400 });
  }
  if (!groups.length) {
    return NextResponse.json({ error: "This map style has no colours that can be changed." }, { status: 400 });
  }

  const system = `You recolour a street map. The map has these colour groups, shown with their current colours:
${groups.map((group) => `- ${group.id}: ${group.label}, currently ${group.color}`).join("\n")}

The user describes the change they want. Reply with a JSON object whose keys are group ids from the list and whose values are the new colours as #rrggbb.
- Include only the groups that should change. Rivers, lakes and sea are the water group; motorways and highways are main roads; smaller roads are streets; the background or paper is land.
- If the user asks for an overall look (for example "a navy and gold theme" or "soft pastel"), choose a colour for every group so the map stays readable: land and water clearly different, roads clearly visible against the land.
- If nothing in the request applies to these groups, reply with {}.
Reply with the JSON object only.`;

  try {
    const reply = await getProvider().writeText(system, prompt);
    const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json || "{}") as Record<string, unknown>;

    const colors: Record<string, string> = {};
    for (const group of groups) {
      const value = parsed[group.id];
      if (typeof value === "string" && HEX.test(value)) {
        colors[group.id] = value.toLowerCase();
      }
    }
    if (!Object.keys(colors).length) {
      return NextResponse.json(
        {
          error: `Nothing in that request matched this map's colour groups (${groups
            .map((group) => group.label)
            .join(", ")}).`,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ colors });
  } catch (error) {
    console.error("[api/map-colors]", error);
    return NextResponse.json(
      {
        error:
          error instanceof SyntaxError
            ? "The colour request could not be understood. Try rewording it."
            : providerMessage(error),
      },
      { status: 502 },
    );
  }
}
