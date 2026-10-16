import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface Found {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string>;
}

/** OpenStreetMap's geocoder. Returns null when the place is not found. */
async function nominatim(query: string): Promise<Found | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url, {
    headers: { "User-Agent": "MappyMomentsImageGenerator/0.1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Nominatim responded with ${response.status}`);
  const [match] = (await response.json()) as NominatimResult[];
  if (!match) return null;

  const address = match.address ?? {};
  const name =
    address.city ??
    address.town ??
    address.village ??
    match.name ??
    match.display_name.split(",")[0];
  const country = address.country ?? "";
  return {
    name,
    country: country === name ? "" : country,
    lat: Number(match.lat),
    lng: Number(match.lon),
  };
}

interface MapboxFeature {
  text: string;
  center: [number, number];
  context?: { id: string; text: string }[];
}

/** Mapbox's geocoder, used when the first one is unavailable. */
async function mapbox(query: string, token: string): Promise<Found | null> {
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set("limit", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("access_token", token);

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Mapbox responded with ${response.status}`);
  const [match] = ((await response.json()).features ?? []) as MapboxFeature[];
  if (!match) return null;
  const country =
    match.context?.find((part) => part.id.startsWith("country"))?.text ?? "";
  return {
    name: match.text,
    country: country === match.text ? "" : country,
    lat: match.center[1],
    lng: match.center[0],
  };
}

// Turns a typed place into real coordinates.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) {
    return NextResponse.json({ error: "Please enter a place." }, { status: 400 });
  }
  if (query.length > 200) {
    return NextResponse.json({ error: "That place name is too long." }, { status: 400 });
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const geocoders = [
    () => nominatim(query),
    ...(token ? [() => mapbox(query, token)] : []),
  ];

  let unavailable = false;
  for (const geocode of geocoders) {
    try {
      const found = await geocode();
      if (found) return NextResponse.json(found);
    } catch (error) {
      // Try the next geocoder rather than failing the whole request.
      unavailable = true;
      console.error("[api/geocode]", error);
    }
  }

  return unavailable
    ? NextResponse.json(
        { error: "The place lookup is unavailable right now. Please try again." },
        { status: 502 },
      )
    : NextResponse.json(
        { error: `We could not find "${query}" on the map. Try adding the country.` },
        { status: 404 },
      );
}
