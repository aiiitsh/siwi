"use client";

import type { AgentId } from "@/lib/client/types";

export const CREW: Record<AgentId, { name: string; color: string; role: string; model: string }> = {
  siwi: { name: "Siwi", color: "#FF6FA5", role: "Producer", model: "Muse Spark · tool calling" },
  spark: { name: "Spark", color: "#8B6CFF", role: "Designer + coder", model: "Muse Spark" },
  pixel: { name: "Pixel", color: "#29D8F5", role: "Artist", model: "Muse Image" },
  tester: { name: "Tester", color: "#A8F03A", role: "QA", model: "Muse Spark · vision" },
  fixer: { name: "Fixer", color: "#F4F6FF", role: "Hard bugs", model: "Muse Wonder" },
  open: { name: "Spark Open", color: "#FF9F5A", role: "Open weights", model: "Muse Spark Open" },
  system: { name: "System", color: "#9AA3C7", role: "", model: "" },
};

/** A small round crew member with a face. Bounces while working. */
export function Avatar({ id, size = 48, active = false }: { id: AgentId; size?: number; active?: boolean }) {
  const c = CREW[id]?.color ?? "#999";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={active ? "crew-bob" : ""} aria-label={CREW[id]?.name}>
      <defs>
        <radialGradient id={`g-${id}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor={c} />
          <stop offset="1" stopColor={c} stopOpacity=".85" />
        </radialGradient>
      </defs>
      {active && <circle cx="24" cy="24" r="23" fill="none" stroke={c} strokeOpacity=".5" strokeWidth="2" className="crew-ring" />}
      <ellipse cx="24" cy="26" rx="18" ry="17" fill={`url(#g-${id})`} />
      {id === "pixel" && <path d="M11 17 Q24 3 37 17 Q24 11 11 17Z" fill="#0B1030" opacity=".85" />}
      {id === "spark" && <path d="M24 4 l3 7 -3 -2 -3 2z" fill="#FFC83D" />}
      {id === "tester" && <rect x="13" y="18" width="22" height="9" rx="4.5" fill="none" stroke="#0B1030" strokeWidth="2" />}
      {id === "fixer" && <path d="M14 13 h20 v4 h-20z" fill="#FFC83D" />}
      {id === "siwi" && <circle cx="34" cy="13" r="4" fill="#FFC83D" />}
      <circle cx="18.5" cy="23" r="2.6" fill="#0B1030" />
      <circle cx="29.5" cy="23" r="2.6" fill="#0B1030" />
      <circle cx="19.3" cy="22.2" r=".9" fill="#fff" />
      <circle cx="30.3" cy="22.2" r=".9" fill="#fff" />
      <path d={active ? "M19 30 Q24 35 29 30" : "M20 30 Q24 32.5 28 30"} stroke="#0B1030" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="14.5" cy="28.5" r="2.2" fill="#fff" opacity=".25" />
      <circle cx="33.5" cy="28.5" r="2.2" fill="#fff" opacity=".25" />
    </svg>
  );
}

export function CrewCard({ id, active, speech, sub }: { id: AgentId; active: boolean; speech?: string; sub?: string }) {
  const m = CREW[id];
  return (
    <div
      className={`relative flex min-w-0 flex-col gap-2 rounded-2xl border p-3 transition-all duration-300 ${active ? "bg-white/[.07]" : "border-white/10 bg-white/[.03] opacity-80"}`}
      style={active ? { borderColor: m.color, boxShadow: `0 0 28px -6px ${m.color}` } : undefined}
    >
      <div className="flex items-center gap-2.5">
        <Avatar id={id} active={active} size={44} />
        <div className="min-w-0">
          <div className="font-extrabold leading-tight" style={{ color: m.color }}>{m.name}</div>
          <div className="mono truncate text-[10px] text-white/50">{m.model}</div>
        </div>
      </div>
      <div className="mono min-h-[2.6em] text-[11px] leading-snug text-white/75">
        {active && sub ? <span className="text-white">{sub}<span className="crew-dots" /></span> : speech ? `“${speech}”` : <span className="text-white/30">{m.role}</span>}
      </div>
    </div>
  );
}
