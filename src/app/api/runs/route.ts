import { NextResponse } from "next/server";
import { createPilotRun } from "@/lib/pilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { issueUrl?: unknown };
    if (typeof body.issueUrl !== "string" || body.issueUrl.length > 500) return NextResponse.json({ error: "Enter a valid GitHub issue URL." }, { status: 400 });
    return NextResponse.json(await createPilotRun(body.issueUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex Pilot could not complete this run.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
