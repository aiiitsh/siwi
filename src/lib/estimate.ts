import "server-only";
import { MODELS, metaPost } from "./meta";
import { prompt, codingContext } from "./prompts";
import { TOKEN_PRICES, IMAGE_PRICE_USD } from "../../config/pricing";
import type { Design, Proposal } from "./schemas";

// M6: what will Season 2 cost? Built from Meta's free token-counting endpoint (exact input size of the
// real upgrade prompt) plus Season 1's actual output tokens, so the pledge goal is grounded in data.

/** Exact input-token count from Meta's token-counting endpoint, with a character-based fallback. */
export async function countTokens(text: string): Promise<{ tokens: number; exact: boolean }> {
  try {
    const r = await Promise.race([
      metaPost<{ input_tokens: number }>("/responses/input_tokens", { model: MODELS.spark, input: text }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
    if (typeof r.input_tokens === "number") return { tokens: r.input_tokens, exact: true };
  } catch (e) {
    console.warn("[estimate] token count failed, using fallback", e);
  }
  return { tokens: Math.ceil(text.length / 3.6), exact: false };
}

export async function runEstimate(design: Design, proposal: Proposal, oldCode: string, s1OutputTokens?: number) {
  const p = TOKEN_PRICES[MODELS.spark];
  const ctx = codingContext();
  const upgradeText = prompt("code.v1") + "\n\n" + ctx + JSON.stringify(design) + JSON.stringify(proposal) + oldCode;
  const { tokens: inTok, exact } = await countTokens(upgradeText);
  const ctxTok = Math.min(inTok, Math.ceil(ctx.length / 3.6)); // the shared kit prefix is usually a prompt-cache hit
  const outTok = Math.round((s1OutputTokens ?? 15000) * 1.15);
  const code = ((inTok - ctxTok) * p.input + ctxTok * p.cachedInput + outTok * p.output) / 1e6;
  const images = (proposal.newSprites.length + 1) * IMAGE_PRICE_USD;
  const tests = (2 * (4000 * p.input + 2500 * p.output)) / 1e6;
  const patch = (inTok * p.input + 12000 * p.output) / 1e6;
  const siwi = (8 * (1200 * p.input + 400 * p.output)) / 1e6;
  const sub = code + images + tests + patch + siwi;
  const lines = [
    { label: "Spark upgrades game.js", usd: code, detail: `${inTok.toLocaleString()} input tokens (${exact ? "counted by Meta's token API" : "estimated"}), ~${outTok.toLocaleString()} output incl. reasoning` },
    { label: "Pixel paints new art", usd: images, detail: `${proposal.newSprites.length} sprites + 1 cover × $${IMAGE_PRICE_USD}` },
    { label: "Tester plays it", usd: tests, detail: "2 playtests with screenshots + vision verdict" },
    { label: "Fix reserve", usd: patch, detail: "one patch loop if Tester finds a bug" },
    { label: "Siwi's decisions", usd: siwi, detail: "about 8 tool-calling checkpoints" },
    { label: "Safety buffer", usd: sub * 0.2, detail: "20%" },
  ];
  const totalUsd = lines.reduce((a, l) => a + l.usd, 0);
  return { lines, totalUsd, method: exact ? "Meta token counting API + Season 1 actuals" : "character estimate + Season 1 actuals" };
}
