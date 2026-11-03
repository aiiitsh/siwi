import "server-only";
import { z } from "zod";
import type OpenAI from "openai";
import { meta, metaPost, MODELS } from "./meta";
import { writeEvent, type Agent } from "./events";
import { costUsd, IMAGE_PRICE_USD, type Usage } from "../../config/pricing";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type CallMeta = {
  model: string;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
};

type Ctx = { gameId?: string | null; season?: number; agent: Agent; step: string };

async function logCall(ctx: Ctx, m: CallMeta, extra: Record<string, unknown> = {}) {
  console.log(
    `[model] ${ctx.agent}/${ctx.step} ${m.model} in=${m.usage.inputTokens} (cached ${m.usage.cachedInputTokens}) ` +
      `out=${m.usage.outputTokens} (reasoning ${m.usage.reasoningTokens}) imgs=${m.usage.images ?? 0} ` +
      `$${m.costUsd.toFixed(5)} ${m.latencyMs}ms`,
  );
  await writeEvent({
    gameId: ctx.gameId,
    season: ctx.season,
    agent: ctx.agent,
    kind: "model_call",
    message: `${ctx.step} via ${m.model}`,
    costUsd: m.costUsd,
    payload: { step: ctx.step, model: m.model, usage: m.usage, latencyMs: m.latencyMs, ...extra },
  });
}

function usageFromChat(u: OpenAI.Completions.CompletionUsage | undefined): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    cachedInputTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

export type ChatOpts<S extends z.ZodType | undefined> = Ctx & {
  messages: ChatMessage[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxCompletionTokens?: number;
  tools?: Tool[];
  /** When set, requests json_schema structured output and validates with zod (one retry on failure). */
  schema?: S;
  schemaName?: string;
  cacheKey?: string;
};

export type ChatResult<T> = CallMeta & {
  text: string;
  data: T;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
};

/** The one wrapper every Muse Spark / Wonder chat call goes through. */
export async function callChat<S extends z.ZodType | undefined = undefined>(
  opts: ChatOpts<S>,
): Promise<ChatResult<S extends z.ZodType ? z.infer<S> : null>> {
  const model = opts.model ?? MODELS.spark;
  const attempts = opts.schema ? 2 : 1;
  let lastErr: unknown;
  let total: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let totalCost = 0;
  const t0 = Date.now();

  for (let i = 0; i < attempts; i++) {
    const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: opts.messages,
      reasoning_effort: (opts.reasoningEffort ?? "medium") as never,
      ...(opts.maxCompletionTokens ? { max_completion_tokens: opts.maxCompletionTokens } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.cacheKey ? { prompt_cache_key: opts.cacheKey } : {}),
      ...(opts.schema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: opts.schemaName ?? "output",
                schema: z.toJSONSchema(opts.schema) as Record<string, unknown>,
              },
            },
          }
        : {}),
    };
    const res = await meta().chat.completions.create(body);
    const u = usageFromChat(res.usage);
    const c = costUsd(model, u);
    total = {
      inputTokens: total.inputTokens + u.inputTokens,
      cachedInputTokens: total.cachedInputTokens + u.cachedInputTokens,
      outputTokens: total.outputTokens + u.outputTokens,
      reasoningTokens: total.reasoningTokens + u.reasoningTokens,
    };
    totalCost += c;
    const message = res.choices[0]?.message;
    const text = message?.content ?? "";
    const meta_: CallMeta = { model, usage: total, costUsd: totalCost, latencyMs: Date.now() - t0 };

    if (!opts.schema) {
      await logCall(opts, meta_);
      return { ...meta_, text, data: null as never, toolCalls: message?.tool_calls ?? [], message };
    }
    try {
      const parsed = opts.schema.parse(JSON.parse(text));
      await logCall(opts, meta_, { attempt: i + 1 });
      return { ...meta_, text, data: parsed as never, toolCalls: [], message };
    } catch (err) {
      lastErr = err;
      console.warn(`[model] ${opts.step}: invalid structured output (attempt ${i + 1})`);
    }
  }
  await logCall(opts, { model, usage: total, costUsd: totalCost, latencyMs: Date.now() - t0 }, { failed: true });
  throw new Error(`Structured output invalid after ${attempts} attempts: ${String(lastErr)}`);
}

type ImagesResponse = {
  data: { b64_json?: string; url?: string; revised_prompt?: string }[];
  output_format?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type ImageOpts = Ctx & {
  prompt: string;
  /** Reference / input images as data URLs or https URLs. When present, uses /images/edits. */
  images?: string[];
  size?: string; // aspect ratio hint, e.g. "1024x1024"
  outputFormat?: "png" | "webp" | "jpeg";
  reasoningStrength?: "low" | "high";
};

export type ImageResult = CallMeta & { b64: string; mime: string; revisedPrompt?: string };

/** The one wrapper every Muse Image call goes through. */
export async function callImage(opts: ImageOpts): Promise<ImageResult> {
  const t0 = Date.now();
  const outputFormat = opts.outputFormat ?? "png";
  const common = {
    model: MODELS.image,
    prompt: opts.prompt,
    n: 1,
    response_format: "b64_json",
    output_format: outputFormat,
    ...(opts.size ? { size: opts.size } : {}),
    ...(opts.reasoningStrength ? { reasoning_strength: opts.reasoningStrength } : {}),
    // We never want web image search pulling in other people's art.
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  };
  const res = opts.images?.length
    ? await metaPost<ImagesResponse>("/images/edits", {
        ...common,
        images: opts.images.map((u) => ({ image_url: u })),
      })
    : await metaPost<ImagesResponse>("/images/generations", common);

  const img = res.data?.[0];
  if (!img?.b64_json) throw new Error("Muse Image returned no b64_json");
  const usage: Usage = {
    inputTokens: res.usage?.input_tokens ?? 0,
    cachedInputTokens: 0,
    outputTokens: res.usage?.output_tokens ?? 0,
    reasoningTokens: 0,
    images: 1,
  };
  const m: CallMeta = { model: MODELS.image, usage, costUsd: IMAGE_PRICE_USD, latencyMs: Date.now() - t0 };
  await logCall(opts, m, { refs: opts.images?.length ?? 0 });
  return { ...m, b64: img.b64_json, mime: `image/${res.output_format ?? outputFormat}`, revisedPrompt: img.revised_prompt };
}
