import { NextResponse } from "next/server";
import { z } from "zod";
import { callChat } from "@/lib/callModel";

export const runtime = "nodejs";
export const maxDuration = 60;

const Hello = z.object({ greeting: z.string(), emoji: z.string() });

/** Live smoke test: one plain call and one structured-output call to Muse Spark. */
export async function GET() {
  try {
    const plain = await callChat({
      agent: "system",
      step: "health.plain",
      reasoningEffort: "low",
      messages: [{ role: "user", content: "Say hi to a game jam team in under 8 words." }],
    });
    const structured = await callChat({
      agent: "system",
      step: "health.structured",
      reasoningEffort: "low",
      schema: Hello,
      schemaName: "hello",
      messages: [{ role: "user", content: "Return a cheerful greeting and one emoji." }],
    });
    return NextResponse.json({
      ok: true,
      plain: { text: plain.text, usage: plain.usage, costUsd: plain.costUsd, latencyMs: plain.latencyMs },
      structured: { data: structured.data, usage: structured.usage, costUsd: structured.costUsd },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
