// Meta Model API prices in USD.
// Source: https://dev.meta.ai/docs/pricing-rate-limits (read 2026-11-03).
// TODO(Ahmed): confirm against the Billing page in the developer console.

export type TokenPrice = {
  input: number; // per 1M uncached input tokens
  cachedInput: number; // per 1M cached input tokens
  output: number; // per 1M output tokens (reasoning tokens are billed as output)
};

export const TOKEN_PRICES: Record<string, TokenPrice> = {
  "muse-spark-1.3": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cachedInput: 0.15, output: 4.25 },
  // Contributor mode: content may be used to train Meta models, in exchange for a lower price.
  "muse-spark-1.3-contributor": { input: 0.1, cachedInput: 0.002, output: 0.2 },
  "muse-spark-1.2-contributor": { input: 0.1, cachedInput: 0.002, output: 0.2 },
  "muse-wonder-1.0": { input: 4.0, cachedInput: 0.2, output: 20.0 },
};

export const IMAGE_PRICE_USD = 0.01; // muse-image-1.0, per generated image

export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  images?: number;
};

export function costUsd(model: string, u: Usage): number {
  if (model.startsWith("muse-image")) return (u.images ?? 0) * IMAGE_PRICE_USD;
  const p = TOKEN_PRICES[model];
  if (!p) return 0;
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    (uncached * p.input + u.cachedInputTokens * p.cachedInput + u.outputTokens * p.output) / 1e6
  );
}
