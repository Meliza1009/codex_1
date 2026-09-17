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
  if (process.env.CODEX_PILOT_LIVE_RUNS === "false") {
    const hostedPreviewError: RunEvent = {
      type: "failed",
      error: {
        code: "hosted_preview",
        title: "Live runs are available in the local demo",
        message: "This hosted preview intentionally shows a sample run. Start Codex Pilot on the Codex-authenticated demo machine to investigate a public GitHub issue.",
      },
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(hostedPreviewError)}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: RunEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      void streamPilotRun(issueUrl, emit).finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
