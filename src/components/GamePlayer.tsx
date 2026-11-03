"use client";

import { useEffect, useRef } from "react";

/** Plays a self-contained game HTML in a sandboxed iframe (scripts only, no same-origin access). */
export default function GamePlayer({ html, title, className }: { html: string; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    // Focus so arrow keys go to the game instead of scrolling the page.
    const t = setTimeout(() => ref.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [html]);
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl ${className ?? ""}`}>
      <iframe
        ref={ref}
        title={title}
        sandbox="allow-scripts"
        srcDoc={html}
        className="block aspect-video w-full"
        onLoad={() => ref.current?.focus()}
      />
    </div>
  );
}
