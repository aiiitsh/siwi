import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const SPRITE_NAMES = ["hero", "enemy", "enemy2", "collectible", "powerup", "goal", "hazard", "tile", "platform", "floor", "key", "door", "lamp", "background"] as const;

export const GENRES = ["platformer", "topdown"] as const;

export const Design = z.object({
  title: z.string().min(1).max(40),
  genre: z.enum(GENRES),
  lighting: z.enum(["day", "dusk", "dark"]),
  tagline: z.string().max(120),
  story: z.string().max(400),
  hero: z.object({ name: z.string().max(30), look: z.string().max(300) }),
  world: z.object({ setting: z.string().max(200), mood: z.string().max(100) }),
  palette: z.object({ sky: hex, skyBottom: hex, ground: hex, groundTop: hex, accent: hex }),
  specialMechanic: z.object({ name: z.string().max(40), howItWorks: z.string().max(300) }),
  levels: z.array(z.object({ name: z.string().max(40), idea: z.string().max(200) })).min(1).max(3),
  sprites: z
    .array(z.object({ name: z.string().regex(/^[a-z][a-z0-9]{1,15}$/), role: z.string().max(60), prompt: z.string().max(400) }))
    .min(6)
    .max(12),
  credits: z.array(z.object({ name: z.string().max(30), used: z.string().max(140) })).max(8),
});
export type Design = z.infer<typeof Design>;

export const CodeOut = z.object({ notes: z.string().max(400), code: z.string().min(50).max(60000) });

export const Bug = z.object({
  id: z.string().max(60),
  title: z.string().max(140),
  severity: z.enum(["blocker", "major", "minor"]),
  evidence: z.string().max(500),
  fixHint: z.string().max(300),
});
export type Bug = z.infer<typeof Bug>;

export const Verdict = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().max(240),
  seen: z.string().max(300),
  bugs: z.array(Bug).max(8),
});
export type Verdict = z.infer<typeof Verdict>;

export const PatchOut = z.object({
  diagnosis: z.string().max(400),
  edits: z.array(z.object({ find: z.string().max(60000), replace: z.string().max(60000) })).min(1).max(12),
});

export const Proposal = z.object({
  title: z.string().max(60),
  pitch: z.string().max(300),
  changes: z
    .array(z.object({ what: z.string().max(160), why: z.string().max(200), requestedBy: z.array(z.string().max(30)).max(8) }))
    .min(1)
    .max(6),
  newSprites: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9]{1,15}$/), role: z.string().max(60), prompt: z.string().max(400) })).max(4),
  newLevel: z.object({ name: z.string().max(40), idea: z.string().max(200) }),
  notIncluded: z.array(z.object({ idea: z.string().max(120), reason: z.string().max(160) })).max(4),
});
export type Proposal = z.infer<typeof Proposal>;

export const Community = z.object({
  comments: z.array(z.object({ name: z.string().max(20), body: z.string().max(220) })).min(3).max(7),
});
