import "server-only";
import sharp from "sharp";

// Muse Image has no transparent background, so sprites are drawn on flat magenta and keyed out here.

export type SpriteKind = "sprite" | "tile" | "platform" | "background" | "cover";

export const KEY_COLOR = "#FF00FF";

/** Removes the magenta backdrop (with soft edges and spill suppression), trims, and scales to max px. */
async function keySprite(buf: Buffer, max: number): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // "magenta-ness": high red and blue, low green
    const m = Math.min(r, b) - g;
    if (m > 150) px[i + 3] = 0;
    else if (m > 70) {
      const a = 1 - (m - 70) / 80;
      px[i + 3] = Math.round(px[i + 3] * a);
      // pull the pink fringe toward neutral
      const avg = Math.round((r + g + b) / 3);
      px[i] = Math.round(r * a + avg * (1 - a)); px[i + 2] = Math.round(b * a + avg * (1 - a));
    }
  }
  return sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .resize(max, max, { fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function processImage(b64: string, kind: SpriteKind): Promise<string> {
  const buf = Buffer.from(b64, "base64");
  let out: Buffer, mime: string;
  switch (kind) {
    case "background":
      out = await sharp(buf).resize(1280, 720, { fit: "cover" }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
      break;
    case "cover":
      out = await sharp(buf).resize(960, 540, { fit: "cover" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      mime = "image/jpeg";
      break;
    case "tile":
      out = await sharp(buf).resize(96, 96, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
      mime = "image/jpeg";
      break;
    case "platform":
      out = await keySprite(buf, 192);
      mime = "image/png";
      break;
    default:
      out = await keySprite(buf, 160);
      mime = "image/png";
  }
  return `data:${mime};base64,${out.toString("base64")}`;
}

export function kindFor(name: string): SpriteKind {
  if (name === "background") return "background";
  if (name === "tile") return "tile";
  if (name === "platform") return "platform";
  if (name === "cover") return "cover";
  return "sprite";
}

/** Builds Pixel's prompt for a sprite. The hero is the style anchor for everything else. */
export function spritePrompt(name: string, subject: string, styleNote: string, hasRef: boolean): { prompt: string; size: string } {
  const original = "Completely original design; do not resemble any existing game, character, mascot, logo or brand. No text, no letters, no watermark.";
  const style = hasRef
    ? `Match ONLY the art style, outline weight, shading and palette of the reference image. The subject is a different thing: ${subject}. Do not copy the reference character's body, face, hat or clothes.`
    : `Subject: ${subject}.`;
  switch (kindFor(name)) {
    case "background":
      return { prompt: `Wide side-scrolling 2D game background, ${styleNote}. ${style} Scenic backdrop only: no characters, no creatures, no UI, soft depth, slightly muted so foreground sprites stand out. ${original}`, size: "1600x900" };
    case "tile":
      return { prompt: `Seamless square 2D game ground tile texture that fills the ENTIRE image edge to edge, ${styleNote}. ${style} Top edge has a grassy or decorated lip, the rest is the solid material. Flat orthographic view, no perspective, no background. ${original}`, size: "1024x1024" };
    case "platform":
      return { prompt: `A single floating 2D platformer ledge piece, wide and short, side view, ${styleNote}. ${style} Centered on a perfectly flat solid magenta (#FF00FF) background with nothing else. ${original}`, size: "1024x1024" };
    case "cover":
      return { prompt: `Key art for a cozy indie platformer, ${styleNote}. ${style} ${original}`, size: "1600x900" };
    default:
      return { prompt: `A single 2D platformer game sprite, full body, side view facing right, centered, clean bold outline, ${styleNote}. ${style} On a perfectly flat solid magenta (#FF00FF) background with nothing else, no shadow, no ground. Do not use magenta or pink-purple in the subject itself. ${original}`, size: "1024x1024" };
  }
}
