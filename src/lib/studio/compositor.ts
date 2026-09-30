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
      return { filter: "contrast(1.08) saturate(0.92) sepia(0.18)", wash: "#c9a882", washAlpha: 0.08, grain: 0.22, vignette: 0.28 };
    case "crush":
      return { filter: "contrast(1.28) saturate(0.72)", wash: "#000000", washAlpha: 0.08, grain: 0.34, vignette: 0.36 };
    case "cool":
      return { filter: "contrast(1.06) saturate(0.78) hue-rotate(12deg)", wash: "#6a8a96", washAlpha: 0.1, grain: 0.16, vignette: 0.24 };
    case "fade":
      return { filter: "contrast(0.88) brightness(1.08) saturate(0.86)", wash: "#d8cfc0", washAlpha: 0.1, grain: 0.12, vignette: 0.16 };
    default:
      return { filter: "contrast(1.02) saturate(1.02)", wash: "#000000", washAlpha: 0, grain: 0.06, vignette: 0.14 };
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

function heldIndex(words: { start: number; end: number }[], t: number): number {
  let held = -1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (t >= word.start && t < word.end) return i;
    if (word.start <= t) held = i;
  }
  return held;
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
  const idx = heldIndex(words, t);
  if (idx < 0) return;
  const current = words[idx]!;
  const mul = sizeMul(prefs.size) * (quality === "preview" && w < 220 ? Math.min(2.6, 480 / w) : 1);
  const baseY = captionY(prefs.position, layout, h);
  const face = fontFace(font);
  const fill = font === "brat" ? "#8ACE00" : "#f2efe8";
  const padX = w * 0.06;
  const maxW = w - padX * 2;
  if (layout === "line" || layout === "karaoke") {
    drawPhrase(ctx, layout, font, effect, words, t, w, prefs, quality, fill, baseY, maxW, mul);
    return;
  }
  let display = current.text.trim() || line.text;
  if (layout === "typewriter") {
    if (t >= current.end) display = current.text;
    else {
      const span = Math.max(0.05, current.end - current.start);
      const p = Math.max(0, Math.min(1, (t - current.start) / span));
      display = current.text.slice(0, Math.max(1, Math.ceil(current.text.length * p)));
    }
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

function drawPhrase(
  ctx: CanvasRenderingContext2D,
  layout: CaptionStyleId,
  font: CaptionFontId,
  effect: CaptionEffectId,
  words: LyricWord[],
  t: number,
  w: number,
  prefs: CaptionPrefs,
  quality: "preview" | "export",
  fill: string,
  y: number,
  maxW: number,
  mul: number,
) {
  const labels = words.map((wd) => applyCase(wd.text, font, prefs.textCase));
  const phrase = labels.join(" ");
  if (effect === "boxed") drawBoxPlate(ctx, phrase, w, y, mul, font, maxW);
  if (layout === "karaoke") {
    drawKaraoke(ctx, words, t, w, y, mul, prefs, font, quality, fill, effect === "outline");
    return;
  }
  const held = heldIndex(words, t);
  const dim = font === "brat" ? "rgba(138,206,0,0.4)" : "rgba(242,239,232,0.42)";
  const fontPx = fitFont(ctx, phrase, maxW, Math.round(w * 0.072 * mul), font);
  ctx.font = fontCss(fontPx, font);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const gap = w * 0.018;
  const widths = labels.map((lb) => ctx.measureText(lb).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1);
  let x = w / 2 - total / 2;
  const face = fontFace(font);
  ctx.save();
  ctx.translate(0, y);
  ctx.scale(1, face.yScale);
  words.forEach((wd, i) => {
    const current = i === held;
    const label = labels[i] ?? "";
    ctx.lineJoin = "round";
    if (effect === "outline" || current) {
      ctx.lineWidth = Math.max(current ? 5 : 3, w * (current ? 0.012 : 0.007));
      ctx.strokeStyle = "#0b0b0c";
      ctx.strokeText(label, x, 0);
    }
    ctx.fillStyle = current ? fill : dim;
    ctx.fillText(label, x, 0);
    x += (widths[i] ?? 0) + gap;
  });
  ctx.restore();
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
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = quality === "export" ? 10 : 0;
  ctx.lineJoin = "round";
  const dim = font === "brat" ? "rgba(138,206,0,0.35)" : "rgba(242,239,232,0.38)";
  const face = fontFace(font);
  ctx.save();
  ctx.translate(0, y);
  ctx.scale(1, face.yScale);
  words.forEach((wd, i) => {
    const label = labels[i] ?? "";
    const wordW = widths[i] ?? 0;
    const span = Math.max(0.05, wd.end - wd.start);
    const progress = t >= wd.end ? 1 : t >= wd.start ? Math.max(0, Math.min(1, (t - wd.start) / span)) : 0;
    ctx.fillStyle = dim;
    if (outline) {
      ctx.lineWidth = Math.max(3, w * 0.008);
      ctx.strokeStyle = "#0b0b0c";
      ctx.strokeText(label, x, 0);
    }
    ctx.fillText(label, x, 0);
    if (progress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 1, -fontPx, wordW * progress + 2, fontPx * 2.4);
      ctx.clip();
      if (outline) {
        ctx.lineWidth = Math.max(4, w * 0.012);
        ctx.strokeStyle = "#0b0b0c";
        ctx.strokeText(label, x, 0);
      }
      ctx.fillStyle = fill;
      ctx.fillText(label, x, 0);
      ctx.restore();
    }
    x += wordW + gap;
  });
  ctx.restore();
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
    const t0 = recipe.cuts[0] ?? 0;
    const t1 = recipe.cuts[recipe.cuts.length - 1] ?? t0 + 1;
    const kenP = Math.max(0, Math.min(1, (time - t0) / Math.max(0.001, t1 - t0)));
    const kenDir = (recipe.seed & 1) === 0 ? 1 : -1;
    const kenZoom = 1 + 0.08 * (kenDir > 0 ? kenP : 1 - kenP);
    const kenX = (((recipe.seed % 7) - 3) / 3) * width * 0.045 * kenP;
    const kenY = ((((recipe.seed >> 3) % 5) - 2) / 2) * height * 0.02 * kenP;

    ctx.save();
    if (recipe.framing === "letterbox") {
      ctx.beginPath();
      ctx.rect(fr.x, fr.y, fr.w, fr.h);
      ctx.clip();
    }
    if (look.filter !== "none") ctx.filter = look.filter;

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

    if (look.grain > 0) {
      ctx.save();
      ctx.globalAlpha = quality === "preview" ? look.grain * 0.85 : look.grain;
      const tile = grain();
      const size = quality === "preview" ? 128 : 96;
      for (let y = 0; y < height; y += size) {
        for (let x = 0; x < width; x += size) ctx.drawImage(tile, x, y, size, size);
      }
      ctx.restore();
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

  const line =
    lyrics.find((entry) => {
      const words = entry.words;
      if (words.length) return time >= words[0]!.start && time < words[words.length - 1]!.end;
      return time >= entry.start && time < entry.end;
    }) ?? null;
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
