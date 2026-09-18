import { verifyPatch, type VerificationOptions } from "@/lib/verification";
import type { VerificationReport, VerificationStage } from "@/lib/pilot-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: VerificationOptions;
  try {
    body = (await request.json()) as VerificationOptions;
    if (!body || typeof body.patch !== "string" || !body.patch.trim()) {
      return Response.json({ error: "A valid patch diff is required for verification." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request body." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  if (process.env.CODEX_PILOT_LIVE_RUNS === "false" || process.env.VERCEL === "1") {
    const hostedUnavailable: VerificationReport = {
      result: "verification_unavailable",
      verdictLabel: "PATCH PROPOSED — NOT VERIFIED",
      summary: "Patch verification is available in the local demo environment. The hosted preview avoids executing arbitrary repository code.",
      stages: [
        {
          id: "workspace",
          name: "Temporary workspace",
          status: "skipped",
          detail: "Local verification environment required",
        },
      ],
      durationMs: 0,
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "completed", report: hostedUnavailable })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
  }

  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emitStep = (stage: VerificationStage, report: Partial<VerificationReport>) => {
        if (!disconnected) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step", stage, report })}\n\n`));
        }
      };

      verifyPatch({
        ...body,
        onStep: emitStep,
      })
        .then((report) => {
          if (!disconnected) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "completed", report })}\n\n`));
          }
        })
        .catch((err) => {
          if (!disconnected) {
            const errorReport: VerificationReport = {
              result: "verification_unavailable",
              verdictLabel: "PATCH FAILED VERIFICATION",
              summary: err instanceof Error ? err.message : "Verification encountered an error.",
              stages: [],
              durationMs: 0,
              error: err instanceof Error ? err.message : String(err),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "failed", error: errorReport.summary, report: errorReport })}\n\n`));
          }
        })
        .finally(() => {
          if (!disconnected) controller.close();
        });
    },
    cancel() {
      disconnected = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
