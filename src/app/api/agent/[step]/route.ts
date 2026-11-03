import { NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import type { Trace } from "@/lib/callModel";
import { callImage } from "@/lib/callModel";
import { runDesign, runCode, runVerdict, runPatch, runDecide, runCommunity, runProposal, runUpgradeCode, type PlayReport } from "@/lib/agents";
import { Design, Proposal, Bug } from "@/lib/schemas";
import { lintGame } from "@/lib/lint";
import { runEstimate } from "@/lib/estimate";
import { processImage, kindFor, spritePrompt } from "@/lib/images";
import { openConfigured } from "@/lib/meta";
import type { BuildStatus } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

// Every pipeline step is a short, stateless route. The browser keeps the game and the event log,
// calls these one at a time (Siwi decides which), and gets back the result plus a trace of every
// model call made (model, tokens, cost, latency).

const Body = {
  design: z.object({ idea: z.string().min(3).max(400) }),
  code: z.object({ design: Design }),
  lint: z.object({ code: z.string().max(60000) }),
  art: z.object({
    name: z.string().regex(/^[a-z][a-z0-9]{1,15}$/),
    subject: z.string().max(500),
    style: z.string().max(300),
    refs: z.array(z.string().max(3_000_000)).max(3).default([]),
  }),
  verdict: z.object({ design: Design.nullable(), report: z.any() }),
  patch: z.object({ code: z.string().max(60000), bugs: z.array(Bug).min(1).max(10), wonder: z.boolean().default(false) }),
  decide: z.object({ status: z.any() }),
  community: z.object({ design: Design }),
  proposal: z.object({ design: Design, comments: z.array(z.object({ name: z.string().max(30), body: z.string().max(500) })).min(1).max(40), open: z.boolean().default(false) }),
  upgrade: z.object({ design: Design, proposal: Proposal, code: z.string().max(60000) }),
  estimate: z.object({ design: Design, proposal: Proposal, code: z.string().max(60000), s1OutputTokens: z.number().optional() }),
};

export async function POST(req: Request, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const trace: Trace[] = [];
  const t0 = Date.now();
  try {
    const json = await req.json();
    const out = await handle(step, json, trace);
    return NextResponse.json({ ok: true, ...out, trace, ms: Date.now() - t0 });
  } catch (e) {
    console.error(`[api/agent/${step}]`, e);
    const msg = e instanceof z.ZodError ? "invalid request: " + e.issues.map((i) => i.path.join(".") + " " + i.message).join("; ") : String((e as Error).message ?? e);
    return NextResponse.json({ ok: false, error: msg.slice(0, 600), trace }, { status: 500 });
  }
}

async function handle(step: string, json: unknown, trace: Trace[]): Promise<Record<string, unknown>> {
  switch (step) {
    case "design": {
      const { idea } = Body.design.parse(json);
      return { design: await runDesign(idea, trace) };
    }
    case "code": {
      const { design } = Body.code.parse(json);
      return await runCode(design, trace);
    }
    case "lint": {
      const { code } = Body.lint.parse(json);
      return { lint: lintGame(code) };
    }
    case "art": {
      const { name, subject, style, refs } = Body.art.parse(json);
      const { prompt, size } = spritePrompt(name, subject, style, refs.length > 0);
      const img = await callImage({ agent: "pixel", step: `art.${name}`, trace, prompt, size, images: refs.length ? refs : undefined, reasoningStrength: "low" });
      const dataUri = await processImage(img.b64, kindFor(name));
      // The hero also comes back as a mid-size reference image for every later sprite (style anchor).
      const ref = name === "hero" || name === "background"
        ? `data:image/jpeg;base64,${(await sharp(Buffer.from(img.b64, "base64")).resize(512, 512, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer()).toString("base64")}`
        : undefined;
      return { name, dataUri, ref };
    }
    case "verdict": {
      const { design, report } = Body.verdict.parse(json);
      return { verdict: await runVerdict(design, report as PlayReport, trace) };
    }
    case "patch": {
      const { code, bugs, wonder } = Body.patch.parse(json);
      return await runPatch(code, bugs, wonder, trace);
    }
    case "decide": {
      const { status } = Body.decide.parse(json);
      return await runDecide(status as BuildStatus, trace);
    }
    case "community": {
      const { design } = Body.community.parse(json);
      return { comments: await runCommunity(design, trace) };
    }
    case "proposal": {
      const { design, comments, open } = Body.proposal.parse(json);
      const useOpen = open && openConfigured();
      return { proposal: await runProposal(design, comments, trace, useOpen), openWeights: useOpen };
    }
    case "upgrade": {
      const { design, proposal, code } = Body.upgrade.parse(json);
      return await runUpgradeCode(design, proposal, code, trace);
    }
    case "estimate": {
      const { design, proposal, code, s1OutputTokens } = Body.estimate.parse(json);
      return { estimate: await runEstimate(design, proposal, code, s1OutputTokens) };
    }
    default:
      throw new Error(`unknown step ${step}`);
  }
}
