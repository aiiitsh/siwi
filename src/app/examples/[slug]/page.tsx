import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { buildGameHtml } from "@/lib/gameHtml";
import ExamplePlay from "./ExamplePlay";

export const dynamic = "force-static";
const EXAMPLES: Record<string, string> = { "meadow-hop": "Meadow Hop", "gravity-garden": "Gravity Garden", "candle-manor": "Candle Manor" };

export function generateStaticParams() {
  return Object.keys(EXAMPLES).map((slug) => ({ slug }));
}

export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = EXAMPLES[slug];
  if (!title) notFound();
  const gameJs = fs.readFileSync(path.join(process.cwd(), "examples", `${slug}.game.js`), "utf8");
  const html = buildGameHtml({ title, gameJs });
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <p className="mono text-xs uppercase tracking-widest text-white/50">Hand-made example on siwi-kit</p>
      <h1 className="mb-6 text-4xl font-extrabold">{title}</h1>
      <ExamplePlay html={html} title={title} />
    </main>
  );
}
