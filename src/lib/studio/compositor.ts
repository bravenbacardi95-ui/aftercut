import { getImage, getVideo, drawCover } from "./media";
import { clipForRecipe } from "./recipes";
import { DEFAULT_CAPTION_PREFS } from "./types";
import type {
  CaptionEffectId,
  CaptionFontId,
  CaptionPrefs,
  CaptionStyleId,
  FramingId,
  LookId,
  LyricLine,
  LyricWord,
  MediaClip,
  Recipe,
} from "./types";

let grainCanvas: HTMLCanvasElement | null = null;
let fontsQueued = false;
let vignetteCanvas: HTMLCanvasElement | null = null;
let vignetteKey = "";

export function ensureCaptionFonts() {
  if (fontsQueued || typeof document === "undefined" || !document.fonts) return;
  fontsQueued = true;
  void Promise.all([
    document.fonts.load('700 64px "Arial Narrow"'),
    document.fonts.load('700 64px "Brat Narrow"'),
    document.fonts.load("400 64px Anton"),
    document.fonts.load("800 64px Outfit"),
    document.fonts.load('italic 600 64px "Instrument Serif"'),
  ]).catch(() => undefined);
}

function grain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 160;
  const g = c.getContext("2d")!;
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 70 + Math.random() * 140;
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

function vignetteOverlay(w: number, h: number, amount: number): HTMLCanvasElement {
  const key = `${w}x${h}:${amount.toFixed(2)}`;
  if (vignetteCanvas && vignetteKey === key) return vignetteCanvas;
  const c = vignetteCanvas ?? document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  const grad = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.78);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${amount})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  vignetteCanvas = c;
  vignetteKey = key;
  return c;
}

function lookFilter(look: LookId): { filter: string; wash: string; washAlpha: number; grain: number; vignette: number } {
  switch (look) {
    case "film":
      return { filter: "contrast(1.04) saturate(0.96)", wash: "#c9a882", washAlpha: 0.06, grain: 0, vignette: 0.22 };
    case "crush":
      return { filter: "contrast(1.12) saturate(0.9)", wash: "#000000", washAlpha: 0.04, grain: 0, vignette: 0.28 };
    case "cool":
      return { filter: "contrast(1.04) saturate(0.86)", wash: "#6a8a96", washAlpha: 0.08, grain: 0, vignette: 0.2 };
    case "fade":
      return { filter: "contrast(0.94) brightness(1.04) saturate(0.92)", wash: "#d8cfc0", washAlpha: 0.06, grain: 0, vignette: 0.12 };
    default:
      return { filter: "none", wash: "#000000", washAlpha: 0, grain: 0, vignette: 0.12 };
  }
}

function frameRect(framing: FramingId, w: number, h: number, t: number, seed: number) {
  const punch = framing === "punch" ? 1.06 + 0.03 * Math.sin(t * 0.45 + seed * 0.01) : 1;
  if (framing === "letterbox") {
    return { x: 0, y: h * 0.08, w, h: h * 0.84, zoom: 1.02 * punch, ox: 0, oy: 0 };
  }
  if (framing === "offset") {
    return { x: 0, y: 0, w, h, zoom: 1.08, ox: 0, oy: -h * 0.04 };
  }
  return { x: 0, y: 0, w, h, zoom: framing === "punch" ? punch : 1, ox: 0, oy: 0 };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function captionY(position: CaptionPrefs["position"], layout: CaptionStyleId, h: number) {
  if (position === "top") return h * 0.2;
  if (position === "low") return h * 0.82;
  return layout === "word" ? h * 0.52 : h * 0.62;
}

function sizeMul(size: CaptionPrefs["size"]) {
  return size === "s" ? 0.82 : size === "l" ? 1.22 : 1;
}

function fontFace(font: CaptionFontId): { family: string; weight: string; style: string; yScale: number; blur: number } {
  switch (font) {
    case "brat":
      return {
        family: '"Arial Narrow", "Brat Narrow", Arial, Helvetica, sans-serif',
        weight: "700",
        style: "normal",
        yScale: 1.05,
        blur: 1.6,
      };
    case "editorial":
      return { family: '"Instrument Serif", Georgia, serif', weight: "600", style: "italic", yScale: 1, blur: 0 };
    case "poster":
      return { family: "Anton, Impact, sans-serif", weight: "400", style: "normal", yScale: 1, blur: 0 };
    default:
      return { family: "Outfit, sans-serif", weight: "800", style: "normal", yScale: 1, blur: 0 };
  }
}

function fontCss(px: number, font: CaptionFontId) {
  const f = fontFace(font);
  return `${f.style} ${f.weight} ${Math.round(px)}px ${f.family}`;
}

function applyCase(text: string, font: CaptionFontId, textCase: CaptionPrefs["textCase"]) {
  if (font === "brat") return text.toLowerCase();
  if (font === "poster") return text.toUpperCase();
  return textCase === "upper" ? text.toUpperCase() : text;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, startPx: number, font: CaptionFontId, min = 18) {
  let px = startPx;
  ctx.font = fontCss(px, font);
  while (px > min && ctx.measureText(text).width > maxW) {
    px -= 2;
    ctx.font = fontCss(px, font);
  }
  return px;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  layout: CaptionStyleId,
  font: CaptionFontId,
  effect: CaptionEffectId,
  line: LyricLine,
  t: number,
  w: number,
  h: number,
  prefs: CaptionPrefs,
  quality: "preview" | "export",
) {
  const words = line.words.length
    ? line.words
    : line.text.split(/\s+/).map((wd, i, arr) => ({
        id: `${line.id}-${i}`,
        text: wd,
        start: line.start + (i / arr.length) * (line.end - line.start),
        end: line.start + ((i + 1) / arr.length) * (line.end - line.start),
        line: 0,
      }));
  const current = words.reduce<LyricWord | null>((best, word) => {
    if (t < word.start || t >= word.end) return best;
    if (!best || word.start >= best.start) return word;
    return best;
  }, null);
  if (!current) return;
  const mul = sizeMul(prefs.size);
  const baseY = captionY(prefs.position, "word", h);
  const face = fontFace(font);
  const fill = font === "brat" ? "#8ACE00" : "#f2efe8";
  const padX = w * 0.06;
  const maxW = w - padX * 2;
  let display = current.text.trim() || line.text;
  if (layout === "typewriter") {
    const span = Math.max(0.05, current.end - current.start);
    const p = Math.max(0, Math.min(1, (t - current.start) / span));
    display = current.text.slice(0, Math.max(1, Math.ceil(current.text.length * p)));
  }
  void quality;
  const painted = applyCase(display, font, prefs.textCase);

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fill;
  let px = Math.round(w * 0.2 * mul);
  const minPx = Math.round(w * 0.15 * mul);
  ctx.font = fontCss(px, font);
  while (px > minPx && ctx.measureText(painted).width > maxW) {
    px -= 2;
    ctx.font = fontCss(px, font);
  }

  if (effect === "boxed") {
    const boxW = Math.min(maxW, ctx.measureText(painted).width + w * 0.08);
    const boxH = px * face.yScale + w * 0.06;
    ctx.fillStyle = "rgba(8,8,8,0.88)";
    ctx.fillRect(w / 2 - boxW / 2, baseY - boxH / 2, boxW, boxH);
    ctx.fillStyle = fill;
  }

  ctx.save();
  ctx.translate(w / 2, baseY);
  ctx.scale(1, face.yScale);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if (effect === "outline") {
    ctx.lineWidth = Math.max(6, w * 0.018);
    ctx.strokeStyle = "#0b0b0c";
    ctx.strokeText(painted, 0, 0);
  }
  ctx.fillStyle = fill;
  if (font === "brat") fillTracked(ctx, painted, 0, 0, -w * 0.003);
  else ctx.fillText(painted, 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawBoxPlate(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  y: number,
  mul: number,
  font: CaptionFontId,
  maxW: number,
) {
  ctx.font = fontCss(w * 0.05 * mul, font);
  const lines = wrapText(ctx, text, maxW);
  const lh = w * 0.07 * mul;
  const boxH = lines.length * lh + w * 0.04;
  const boxW = Math.min(maxW, Math.max(...lines.map((ln) => ctx.measureText(ln).width), 40) + w * 0.08);
  ctx.fillStyle = "rgba(8,8,8,0.88)";
  ctx.fillRect(w / 2 - boxW / 2, y - boxH / 2, boxW, boxH);
}

function fillTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  const chars = [...text];
  if (!chars.length) return;
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let cx = x - total / 2;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += (widths[i] ?? 0) + tracking;
  });
}

function drawKaraoke(
  ctx: CanvasRenderingContext2D,
  words: LyricWord[],
  t: number,
  w: number,
  y: number,
  mul: number,
  prefs: CaptionPrefs,
  font: CaptionFontId,
  quality: "preview" | "export",
  fill: string,
  outline: boolean,
) {
  const labels = words.map((wd) => applyCase(wd.text, font, prefs.textCase));
  let fontPx = Math.round(w * 0.07 * mul);
  ctx.font = fontCss(fontPx, font);
  const gap = w * 0.016;
  const maxW = w * 0.86;
  let widths = labels.map((lb) => ctx.measureText(lb).width);
  let total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1);
  if (total > maxW && total > 0) {
    fontPx = Math.max(18, Math.floor(fontPx * (maxW / total)));
    ctx.font = fontCss(fontPx, font);
    widths = labels.map((lb) => ctx.measureText(lb).width);
    total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1);
  }
  let x = w / 2 - total / 2;
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = quality === "export" ? 10 : 0;
  ctx.lineJoin = "round";
  words.forEach((wd, i) => {
    const state = t >= wd.start && t < wd.end ? "current" : "idle";
    if (state !== "current") return;
    const color = fill;
    const label = labels[i] ?? "";
    if (outline) {
      ctx.lineWidth = Math.max(4, w * 0.012);
      ctx.strokeStyle = "#0b0b0c";
      ctx.strokeText(label, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
    x += (widths[i] ?? 0) + gap;
  });
}

function sourceSize(el: CanvasImageSource): { sw: number; sh: number } {
  if (el instanceof HTMLVideoElement) return { sw: el.videoWidth, sh: el.videoHeight };
  if (el instanceof HTMLImageElement) return { sw: el.naturalWidth, sh: el.naturalHeight };
  if (el instanceof HTMLCanvasElement) return { sw: el.width, sh: el.height };
  return { sw: 0, sh: 0 };
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  opts: {
    recipe: Recipe;
    clips: MediaClip[];
    lyrics: LyricLine[];
    time: number;
    width: number;
    height: number;
    captionPrefs?: CaptionPrefs;
    quality?: "preview" | "export";
  },
) {
  const { recipe, clips, lyrics, time, width, height } = opts;
  const prefs = opts.captionPrefs ?? DEFAULT_CAPTION_PREFS;
  const quality = opts.quality ?? "export";
  try {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality === "export" ? "high" : "low";
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, width, height);

  {
    const clip = clipForRecipe(recipe, clips, time) ?? clips[0];
    const look = lookFilter(recipe.look);
    const fr = frameRect(recipe.framing, width, height, time, recipe.seed);
    const kenZoom = 1;
    const kenX = 0;
    const kenY = 0;

    ctx.save();
    if (recipe.framing === "letterbox") {
      ctx.beginPath();
      ctx.rect(fr.x, fr.y, fr.w, fr.h);
      ctx.clip();
    }
    if (quality === "export") ctx.filter = look.filter;

    if (clip) {
      if (clip.kind === "video") {
        const vid = getVideo(clip.src);
        const { sw, sh } = sourceSize(vid);
        if (clip.poster) {
          const img = getImage(clip.poster);
          const s = sourceSize(img);
          if (s.sw && (!sw || vid.readyState < 2)) {
            drawCover(ctx, img, s.sw, s.sh, fr.x, fr.y, fr.w, fr.h, fr.zoom * kenZoom, kenX + fr.ox, kenY + fr.oy);
          }
        }
        if (sw && sh && vid.readyState >= 2) {
          drawCover(ctx, vid, sw, sh, fr.x, fr.y, fr.w, fr.h, fr.zoom * kenZoom, kenX + fr.ox, kenY + fr.oy);
        }
      } else {
        const img = getImage(clip.src);
        const s = sourceSize(img);
        if (s.sw) drawCover(ctx, img, s.sw, s.sh, fr.x, fr.y, fr.w, fr.h, fr.zoom * kenZoom, kenX + fr.ox, kenY + fr.oy);
        else {
          ctx.fillStyle = "#1c1c1e";
          ctx.fillRect(fr.x, fr.y, fr.w, fr.h);
        }
      }
    }
    ctx.filter = "none";
    ctx.restore();

    if (look.washAlpha > 0) {
      ctx.fillStyle = look.wash;
      ctx.globalAlpha = look.washAlpha;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    if (look.grain > 0 && quality === "export") {
      ctx.globalAlpha = look.grain;
      ctx.drawImage(grain(), 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    if (look.vignette > 0) {
      ctx.drawImage(vignetteOverlay(width, height, look.vignette), 0, 0);
    }

    if (recipe.framing === "letterbox") {
      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(0, 0, width, height * 0.08);
      ctx.fillRect(0, height * 0.92, width, height * 0.08);
    }
  }

  const line = lyrics.find((entry) => entry.words.some((word) => time >= word.start && time < word.end)) ?? null;
  if (line) {
    drawCaption(
      ctx,
      recipe.captionStyle,
      recipe.font ?? "clean",
      recipe.effect ?? "none",
      line,
      time,
      width,
      height,
      prefs,
      quality,
    );
  }
  } catch {
    /* keep last frame rather than crash the studio */
  }
}
