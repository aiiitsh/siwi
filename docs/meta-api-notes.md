# Meta Model API notes

Read from the official docs at https://dev.meta.ai/docs (ai.developer.meta.com/docs redirects there) on 2026-11-03.
"Verified live" marks things confirmed with a real call; everything else is from the docs only.

## Basics
- Base URL `https://api.meta.ai/v1`. Auth `Authorization: Bearer $MODEL_API_KEY`.
- OpenAI-compatible: Chat Completions (`POST /v1/chat/completions`) and Responses (`POST /v1/responses`). Anthropic-compatible Messages (`/v1/messages`). The `openai` npm SDK works with `baseURL`.
- `GET /v1/models` lists models. Status page: https://dev.meta.ai/docs/api-reference/status
- Region: Muse Image says "country restrictions apply per the Geographic Use Policy". Canada access: **to verify live**.

## Models
| ID | What | Notes |
|---|---|---|
| `muse-spark-1.3` | Reasoning model, 1M context; text/image/video/audio/PDF in, text out | Recommended. All reasoning levels incl. `max`. Tools, structured output, search grounding. |
| `muse-spark-1.2`, `muse-spark-1.1` | Older Spark | |
| `muse-spark-1.3-contributor`, `-1.2-contributor` | Same model, **Contributor mode** | "Your content may be used to train future Meta models, in exchange for a lower price." No `max` reasoning. 150 RPM. |
| `muse-wonder-1.0` | Bigger model (preview), 1M context; also audio in; computer use | Standard mode only on pay-as-you-go. |
| `muse-image-1.0` | Image generation and editing in one model; agentic (can search web/run code before rendering) | |
| `muse-voice-transcribe-1.0` | ASR: `POST /v1/asr/transcribe`, realtime `wss://api.meta.ai/v1/asr/realtime` | |
| `sam-3.1` | Segmentation: text/box/point prompts → boxes and masks, via Responses API + Files API | |
| Muse Spark Open | Open weights, 816B MoE / 42B active. Not on Model API. | Baseten id from hackathon: `meta-models/muse-spark-open-1026` |
| Muse Glimmer | Open weights, distilled from Spark, text+image in. Self-host (vLLM, SGLang, llama.cpp) | |

## Prices (USD) and limits
| Model | Input /1M | Cached input /1M | Output /1M |
|---|---|---|---|
| muse-spark-1.x | 1.25 | 0.15 | 4.25 |
| muse-spark-1.x-contributor | 0.10 | 0.002 | 0.20 |
| muse-wonder-1.0 | 4.00 | 0.20 | 20.00 |

- muse-image-1.0: $0.01 per image. SAM 3.1: $2.50 per 1,000 images. Voice: $0.18/hour. Search grounding: $2.50 per 1,000 queries.
- Rate limits per team: Spark/Wonder 3,000 RPM / 4M TPM; **Muse Image 150 RPM**; contributor 150 RPM.
- Reasoning tokens are part of output (`max_completion_tokens` caps visible + reasoning).
- Encoded in `config/pricing.ts`.

## Chat Completions
- `reasoning_effort`: `none | minimal | low | medium | high | xhigh | max`.
- `max_completion_tokens` (not `max_tokens`, deprecated). `n` must be 1. `stop` not supported with reasoning models.
- `stream: true` + `stream_options: { include_usage: true }` → usage only on the final chunk.
- `prompt_cache_key` (stable per use case), `safety_identifier`.
- Usage: `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`.
- Image input: content part `{ type: "image_url", image_url: { url: <https or data URL>, detail: auto|low|high } }`.

## Structured output
- `response_format: { type: "json_schema", json_schema: { name, schema, strict? } }`. `json_object` only guarantees valid JSON.
- Output conforms to the schema even with `strict: false`; `strict: true` only makes the server reject schemas outside the strict subset (root plain object, no `oneOf`/`allOf`, `additionalProperties: false` everywhere, all keys required).
- Limits: depth 10, 5,000 properties, no recursive `$ref`.
- Works together with tool calling. We still validate everything with zod.

## Tool calling
- **`tool_choice` only supports `"auto"`.** `required`/`none`/named function → HTTP 400. So Siwi's orchestrator must handle a plain-text reply (we retry with a nudge, then fall back to a deterministic rule).
- Parallel calls on by default; `parallel_tool_calls: false` for one call per turn (we use this for Siwi).
- Return results: append the assistant message with `tool_calls`, then one `{role:"tool", tool_call_id, content}` per call.
- Validate arguments ourselves; strict mode doesn't guarantee them.

## Prompt caching
- Automatic on every request; stable prefix first (system prompt, kit, examples), variable content last.
- `prompt_cache_key` raises hit rate. `prompt_cache_retention: "24h"` is Responses-only and a hint.
- Cached tokens reported in `usage.prompt_tokens_details.cached_tokens`; billed at $0.15/1M instead of $1.25/1M.

## Token counting
- `POST /v1/responses/input_tokens` with `{ model, input }` → `{ object: "response.input_tokens", input_tokens }`.
- `POST /v1/messages/count_tokens` (Anthropic shape).
- Docs: use for context-fit, not billing estimates. Free (no generation).

## Muse Image
- `POST /v1/images/generations`: `model, prompt, n (1-10), size ("WxH", sets aspect ratio only), response_format (b64_json default | url), output_format (webp default | png | jpeg), reasoning_strength (high default | low, same price), temperature (planning only), stream, tool_enablement {enable_image_search, enable_web_search, enable_shell}`.
- `POST /v1/images/edits` JSON shape: same fields plus `images: [{ image_url } | { file_id }]`, **1 to 10 input images** (reference images, composition, iterative edits). The SDK's `images.edit` sends multipart instead; we use raw `fetch` for the JSON shape.
- Response: `{ created, data: [{ b64_json, url, revised_prompt }], output_format, usage }`.
- **No transparent background** (`background` is always opaque). We key out magenta with sharp.
- We set all `tool_enablement` flags to false so it never pulls in reference imagery of existing games or brands.
- Multi-turn via Responses API with `previous_response_id`, or upload references once to `/v1/files` and pass `file_id`.

## Open weights (S1)
- Muse Spark Open on Baseten: model `meta-models/muse-spark-open-1026` (hackathon-provided id). To verify: endpoint URL and auth from Baseten.

## Live verification log
- [ ] `GET /v1/models` from Canada
- [ ] Muse Spark chat + structured output
- [ ] Muse Image generation (format, latency, magenta keying quality)
- [ ] Muse Image edits with reference image
