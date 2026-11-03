import { NextResponse } from "next/server";
import { callImage } from "@/lib/callModel";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Live smoke test: one Muse Image generation on a magenta key background. Returns the image inline. */
export async function GET() {
  try {
    const img = await callImage({
      agent: "pixel",
      step: "health.image",
      size: "1024x1024",
      prompt:
        "Original pixel-art game hero: a cute round pink blob with big glowing white eyes, centered, full body, " +
        "on a flat solid pure magenta #FF00FF background, no shadow, no text. Do not copy any existing game, character or brand.",
    });
    return NextResponse.json({
      ok: true,
      costUsd: img.costUsd,
      latencyMs: img.latencyMs,
      usage: img.usage,
      dataUrl: `data:${img.mime};base64,${img.b64}`,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
