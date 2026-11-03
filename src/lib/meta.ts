import "server-only";
import OpenAI from "openai";

export const META_BASE_URL = process.env.META_BASE_URL ?? "https://api.meta.ai/v1";

export const MODELS = {
  spark: process.env.SIWI_SPARK_MODEL ?? "muse-spark-1.3",
  image: "muse-image-1.0",
  wonder: "muse-wonder-1.0",
} as const;

let client: OpenAI | null = null;

export function metaKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set (put it in .env.local)");
  return key;
}

/** OpenAI SDK pointed at Meta's OpenAI-compatible endpoint. Server only. */
export function meta(): OpenAI {
  if (!client) client = new OpenAI({ baseURL: META_BASE_URL, apiKey: metaKey() });
  return client;
}

/** Raw JSON POST for endpoints whose JSON shape the SDK doesn't send (e.g. images/edits with image_url). */
export async function metaPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${META_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${metaKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta ${path} ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}
