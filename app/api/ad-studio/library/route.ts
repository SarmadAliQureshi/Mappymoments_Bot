import { NextResponse } from "next/server";
import { recoverJobs } from "@/lib/adstudio/jobs";
import { readLibrary } from "@/lib/adstudio/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The whole saved library, newest first. Also the endpoint the page polls
// for job progress.
export async function GET() {
  recoverJobs();
  return NextResponse.json({ entries: readLibrary() });
}
