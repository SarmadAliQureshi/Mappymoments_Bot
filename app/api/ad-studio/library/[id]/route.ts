import { NextResponse } from "next/server";
import { deleteEntry } from "@/lib/adstudio/library";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!deleteEntry(id)) {
    return NextResponse.json({ error: "That item is not in the library." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
