"use client";

import { useRef, useState } from "react";
import type { Comment } from "@/lib/client/types";
import { shrink } from "@/lib/client/runner";

/** Reads picked files into resized JPEG data URIs (pictures and drawings players attach). */
export async function readPictures(files: FileList | null, max = 4): Promise<string[]> {
  const out: string[] = [];
  for (const f of Array.from(files ?? []).slice(0, max)) {
    if (!f.type.startsWith("image/")) continue;
    const raw = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    out.push(await shrink(raw, 768));
  }
  return out;
}

type Props = {
  comments: Comment[];
  me: string;
  placeholder: string;
  onAdd?: (body: string, image?: string) => void;
  onSimulate?: () => void;
  simulating?: boolean;
  empty: string;
  title?: string;
};

/** A game thread: text comments plus pictures, from anyone. */
export default function Thread({ comments, me, placeholder, onAdd, onSimulate, simulating, empty, title }: Props) {
  const [text, setText] = useState("");
  const [pic, setPic] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const send = () => {
    if (!onAdd || (!text.trim() && !pic)) return;
    onAdd(text.trim(), pic);
    setText(""); setPic(undefined);
  };
  return (
    <div className="space-y-2">
      {title && <div className="text-sm font-bold text-white/70">{title}</div>}
      <div className="scroll-thin max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {comments.length === 0 && <p className="text-sm text-white/50">{empty}</p>}
        {comments.map((c) => (
          <div key={c.id} className="pop-in flex gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{c.name.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <div><b>{c.name}</b>{c.simulated && <span className="mono ml-1 text-[10px] text-white/40">simulated player</span>}</div>
              {c.body && <div className="text-white/85">{c.body}</div>}
              {c.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.image} alt={`picture from ${c.name}`} className="mt-1.5 max-h-48 rounded-lg border border-white/10" />
              )}
            </div>
          </div>
        ))}
      </div>
      {onAdd && (
        <div className="rounded-2xl border border-white/15 bg-black/30 p-2">
          {pic && (
            <div className="relative mb-2 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pic} alt="attached" className="h-20 rounded-lg" />
              <button onClick={() => setPic(undefined)} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-bug text-xs font-bold" aria-label="Remove picture">×</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-white/35"
              onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const [p] = await readPictures(e.target.files, 1); setPic(p); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10" title="Attach a picture or drawing">+ picture</button>
            <button onClick={send} disabled={!text.trim() && !pic} className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-bold hover:bg-white/25 disabled:opacity-40">Post as {me}</button>
          </div>
        </div>
      )}
      {onSimulate && (
        <button onClick={onSimulate} disabled={simulating} className="mono rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/60 hover:bg-white/10 disabled:opacity-40">
          {simulating ? "players are typing…" : "+ simulated players (demo)"}
        </button>
      )}
    </div>
  );
}
