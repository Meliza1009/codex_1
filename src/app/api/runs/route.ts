import { streamPilotRun } from "@/lib/pilot";
import type { RunEvent } from "@/lib/pilot-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let issueUrl = "";
  try {
    const body = await request.json() as { issueUrl?: unknown };
    if (typeof body.issueUrl !== "string" || body.issueUrl.length > 500) throw new Error("Enter a valid GitHub issue URL.");
    issueUrl = body.issueUrl;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Enter a valid GitHub issue URL." }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: RunEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      void streamPilotRun(issueUrl, emit).finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
