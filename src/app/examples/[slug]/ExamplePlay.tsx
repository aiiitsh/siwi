"use client";

import { useState } from "react";
import GamePlayer from "@/components/GamePlayer";
import { playtest, type TestReport } from "@/lib/playtester";

export default function ExamplePlay({ html, title }: { html: string; title: string }) {
  const [report, setReport] = useState<TestReport | null>(null);
  const [running, setRunning] = useState(false);
  return (
    <div className="space-y-4">
      <GamePlayer html={html} title={title} />
      <p className="mono text-sm text-white/60">Arrows / WASD to move · Space to jump · X to flip gravity (if the game has it) · R to restart</p>
      <button
        className="rounded-full bg-tester px-5 py-2 font-bold text-navy disabled:opacity-50"
        disabled={running}
        onClick={async () => {
          setRunning(true);
          setReport(await playtest(html));
          setRunning(false);
        }}
      >
        {running ? "Tester is playing…" : "Run Tester playtest"}
      </button>
      {report && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className={`mb-2 font-bold ${report.pass ? "text-tester" : "text-bug"}`}>{report.pass ? "All checks passed" : "Checks failed"}</p>
          <ul className="mono space-y-1 text-sm">
            {report.checks.map((c) => (
              <li key={c.id}>
                <span className={c.pass ? "text-tester" : "text-bug"}>{c.pass ? "✓" : "✗"}</span> {c.id}: <span className="text-white/60">{c.detail}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {report.screenshots.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.at} src={s.dataUrl} alt={`t=${s.at}ms`} className="rounded-lg" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
