import { readFile } from "@/lib/adstudio/library";

export const runtime = "nodejs";

// Serves a stored image or video. Byte ranges are supported so videos can be
// played and scrubbed in every browser.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const stored = readFile(file);
  if (!stored) return new Response("Not found", { status: 404 });

  const total = stored.data.length;
  const headers: Record<string, string> = {
    "Content-Type": stored.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (new URL(request.url).searchParams.has("download")) {
    headers["Content-Disposition"] = `attachment; filename="mappy-moments-ad-${file}"`;
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    return new Response(new Uint8Array(stored.data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(new Uint8Array(stored.data), {
    headers: { ...headers, "Content-Length": String(total) },
  });
}
