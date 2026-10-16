// The live map styles used on mappymoments.com. Most are raster tile URLs;
// Mapbox styles are also drawn with Mapbox GL (see glRender.ts).

export interface TileStyle {
  id: string;
  name: string;
  /** Tile URL template with {z}, {x} and {y}. */
  url: string;
  /** Deepest zoom the provider serves; closer views enlarge these tiles. */
  maxZoom?: number;
  /** Mapbox style URL: drawn with Mapbox GL so its colours can be changed. */
  gl?: string;
}

const THUNDERFOREST = process.env.NEXT_PUBLIC_THUNDERFOREST_KEY ?? "";
const MAPTILER = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const JAWG = process.env.NEXT_PUBLIC_JAWG_TOKEN ?? "";
const MAPBOX = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export const MAPBOX_TOKEN = MAPBOX;

const stadia = (name: string) =>
  `https://tiles.stadiamaps.com/tiles/${name}/{z}/{x}/{y}.png`;
const arcgis = (name: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`;
const thunderforest = (name: string) =>
  `https://tile.thunderforest.com/${name}/{z}/{x}/{y}.png?apikey=${THUNDERFOREST}`;
const maptiler = (name: string) =>
  `https://api.maptiler.com/maps/${name}/256/{z}/{x}/{y}.png?key=${MAPTILER}`;
const jawg = (name: string) =>
  `https://tile.jawg.io/${name}/{z}/{x}/{y}.png?access-token=${JAWG}`;
// mapbox:// style URLs are served as raster tiles by the Static Tiles API.
const mapbox = (style: string) =>
  `https://api.mapbox.com/styles/v1/${style}/tiles/256/{z}/{x}/{y}?access_token=${MAPBOX}`;

interface StyleEntry extends TileStyle {
  /** The key this style needs; the style is hidden while it is empty. */
  requires?: string;
}

const ALL_STYLES: StyleEntry[] = [
  { id: "alidade-smooth", name: "Alidade Smooth", url: stadia("alidade_smooth") },
  { id: "stadia-toner-bg", name: "Stadia Map", url: stadia("stamen_toner_background") },
  { id: "stamen-toner", name: "Stamen Toner", url: stadia("stamen_toner") },
  { id: "stadia-smooth-dark", name: "Stadia Smooth Dark", url: stadia("alidade_smooth_dark") },
  { id: "osm-bright", name: "OSM Bright", url: stadia("osm_bright") },
  { id: "stadia-outdoors", name: "Stadia Outdoors", url: stadia("outdoors") },
  { id: "stamen-terrain", name: "Stamen Terrain", url: stadia("stamen_terrain_background") },
  { id: "open-topo", name: "Open Topo", url: "https://b.tile.opentopomap.org/{z}/{x}/{y}.png" },
  { id: "cycling-trail", name: "Cycling Trail", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
  { id: "world-ocean", name: "World Ocean", url: arcgis("Ocean/World_Ocean_Base"), maxZoom: 10 },
  { id: "world-shaded-relief", name: "World Shaded Relief", url: arcgis("World_Shaded_Relief"), maxZoom: 13 },
  { id: "world-physical", name: "World Physical Map", url: arcgis("World_Physical_Map"), maxZoom: 8 },
  { id: "usgs-topo", name: "USGS Topomap", url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}" },
  { id: "maptiler-basic", name: "Maptiler Basic", url: maptiler("basic-v2"), requires: MAPTILER },
  { id: "maptiler-toner", name: "Maptiler Toner", url: maptiler("toner-v2"), requires: MAPTILER },
  { id: "maptiler-ocean", name: "Maptiler Ocean", url: maptiler("ocean"), requires: MAPTILER },
  { id: "maptiler-topo", name: "Maptiler Topo", url: maptiler("topo-v2"), requires: MAPTILER },
  { id: "maptiler-outdoor", name: "Maptiler Outdoor", url: maptiler("outdoor"), requires: MAPTILER },
  { id: "jawg-street", name: "Jawg Street", url: jawg("jawg-streets"), requires: JAWG },
  { id: "jawg-dark", name: "Jawg Dark", url: jawg("jawg-dark"), requires: JAWG },
  { id: "jawg-matrix", name: "Jawg Matrix", url: jawg("jawg-matrix"), requires: JAWG },
  { id: "thunder-cycle", name: "Thunder CycleMap", url: thunderforest("cycle"), requires: THUNDERFOREST },
  { id: "thunder-spinal", name: "Thunder Spinal", url: thunderforest("spinal-map"), requires: THUNDERFOREST },
  { id: "thunder-pioneer", name: "Thunder Pioneer", url: thunderforest("pioneer"), requires: THUNDERFOREST },
  { id: "thunder-transport", name: "Thunder Transport", url: thunderforest("transport"), requires: THUNDERFOREST },
  { id: "thunder-landscape", name: "Thunder Landscape", url: thunderforest("landscape"), requires: THUNDERFOREST },
  { id: "thunder-transport-dark", name: "Thunder Transport Dark", url: thunderforest("transport-dark"), requires: THUNDERFOREST },
  { id: "thunder-neighbourhood", name: "Thunder Neighbourhood", url: thunderforest("neighbourhood"), requires: THUNDERFOREST },
  { id: "thunder-mobile-atlas", name: "Thunder Mobile Atlas", url: thunderforest("mobile-atlas"), requires: THUNDERFOREST },
  { id: "thunder-outdoors", name: "Thunder Outdoors", url: thunderforest("outdoors"), requires: THUNDERFOREST },
  { id: "mappy-studio", name: "Mappy Studio", url: mapbox("mappymoments/cmkfx6t2e00bz01r183yx6cbq"), gl: "mapbox://styles/mappymoments/cmkfx6t2e00bz01r183yx6cbq", requires: MAPBOX },
  { id: "mapbox-light", name: "Light Map", url: mapbox("mapbox/light-v10"), gl: "mapbox://styles/mapbox/light-v10", requires: MAPBOX },
  { id: "mapbox-dark", name: "Obsidian", url: mapbox("mapbox/dark-v10"), gl: "mapbox://styles/mapbox/dark-v10", requires: MAPBOX },
  { id: "mapbox-outdoors", name: "Outdoors", url: mapbox("mapbox/outdoors-v11"), gl: "mapbox://styles/mapbox/outdoors-v11", requires: MAPBOX },
  { id: "mapbox-navigation-day", name: "Navigation Day", url: mapbox("mapbox/navigation-day-v1"), gl: "mapbox://styles/mapbox/navigation-day-v1", requires: MAPBOX },
  { id: "mapbox-navigation-night", name: "Navigation", url: mapbox("mapbox/navigation-night-v1"), gl: "mapbox://styles/mapbox/navigation-night-v1", requires: MAPBOX },
  { id: "mapbox-satellite", name: "Satellite Nolabels", url: mapbox("mapbox/satellite-v9"), gl: "mapbox://styles/mapbox/satellite-v9", requires: MAPBOX },
  { id: "mapbox-satellite-streets", name: "Satellite", url: mapbox("mapbox/satellite-streets-v11"), gl: "mapbox://styles/mapbox/satellite-streets-v11", requires: MAPBOX },
];

export const TILE_STYLES: TileStyle[] = ALL_STYLES.filter(
  (style) => style.requires === undefined || style.requires !== "",
)
  .map(({ id, name, url, maxZoom, gl }) => ({ id, name, url, maxZoom, gl }))
  // Mapbox styles first: they are the ones whose colours can be changed.
  .sort((a, b) => Number(!!b.gl) - Number(!!a.gl));

// The brand's own Mapbox style when a token is set; its colours can be edited.
export const DEFAULT_TILE_STYLE_ID = MAPBOX ? "mappy-studio" : "alidade-smooth";

export function getTileStyle(id: string): TileStyle {
  return TILE_STYLES.find((style) => style.id === id) ?? TILE_STYLES[0];
}

export function tileUrl(style: TileStyle, z: number, x: number, y: number) {
  return style.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
