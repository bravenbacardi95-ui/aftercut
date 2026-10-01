import { getImage, getVideo, drawCover } from "./media";
import { clipForRecipe } from "./recipes";
import { DEFAULT_CAPTION_PREFS } from "./types";
import type {
  BratPlateId,
  BratPlateMode,
  CaptionEffectId,
  CaptionFontId,
  CaptionPosId,
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
        family: '"Brat Narrow", "Arial Narrow", Arial, Helvetica, sans-serif',
        weight: "700",
        style: "normal",
        yScale: 1,
        blur: 0,
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

const BRAT_SX = 0.85;

type BratTok = { text: string; start: number; end: number; key: string };

function bratPlateColor(plate: BratPlateId) {
  if (plate === "green") return "#8ACE00";
  if (plate === "black") return "#000000";
  return "#ffffff";
}

function bratInk(plate: BratPlateId) {
  return plate === "black" ? "#8ACE00" : "#1a1a1a";
}

function bratTokens(lyrics: LyricLine[]): BratTok[] {
  const out: BratTok[] = [];
  for (const line of lyrics) {
    const words = line.words.length
      ? line.words
      : line.text.split(/\s+/).filter(Boolean).map((wd, i, arr) => ({
          text: wd,
          start: line.start + (i / arr.length) * (line.end - line.start),
          end: line.start + ((i + 1) / arr.length) * (line.end - line.start),
        }));
    for (const word of words) {
      const text = word.text.trim().toLowerCase();
      if (!text) continue;
      out.push({
        text,
        start: word.start,
        end: Math.max(word.end, word.start + 0.04),
        key: line.id,
      });
    }
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Phrase blocks: break on line ends, pauses ≥ 400ms, or 12 words. */
function groupBratBlocks(tokens: BratTok[]): BratTok[][] {
  const blocks: BratTok[][] = [];
  let cur: BratTok[] = [];
  const flush = () => {
    if (cur.length) blocks.push(cur);
    cur = [];
  };
  for (const word of tokens) {
    const prev = cur[cur.length - 1];
    if (prev && (word.key !== prev.key || word.start - prev.end >= 0.4 || cur.length >= 12)) flush();
    cur.push(word);
  }
  flush();
  return blocks;
}

function wrapVisual(widths: number[], blockW: number, gap: number): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  widths.forEach((width, i) => {
    if (!row.length) {
      row = [i];
      used = width;
      return;
    }
    if (used + gap + width > blockW + 0.5) {
      rows.push(row);
      row = [i];
      used = width;
    } else {
      row.push(i);
      used += gap + width;
    }
  });
  if (row.length) rows.push(row);
  return rows;
}

export function bratSampleTime(lyrics: LyricLine[], start: number, end: number) {
  const blocks = groupBratBlocks(bratTokens(lyrics));
  const block = blocks.find((item) => item[item.length - 1]!.end > start && item[0]!.start < end);
  if (!block?.length) return start + 0.12;
  const t = block[block.length - 1]!.start + 0.02;
  return Math.min(Math.max(start, t), Math.max(start, end - 0.04));
}

function yOrigin(position: CaptionPosId, frameH: number, blockH: number, lh: number) {
  const mid = (frameH - blockH) / 2 + lh / 2;
  if (position === "mid") return mid;
  if (position === "top") return Math.max(lh * 0.35, frameH * 0.08 + lh / 2);
  return Math.max(lh * 0.35, Math.min(frameH * 0.92 - blockH + lh / 2, frameH - lh * 0.4));
}

function chooseBrat(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  plateW: number,
  frameH: number,
  rowTarget?: number,
) {
  const target = plateW * 0.85;
  const maxPx = Math.max(20, Math.round(plateW * 0.22));
  const minPx = Math.max(12, Math.round(plateW * 0.03));
  let best: {
    score: number;
    px: number;
    gap: number;
    widths: number[];
    rows: number[][];
    naturals: number[];
    lh: number;
  } | null = null;
  for (let px = maxPx; px >= minPx; px -= 2) {
    ctx.font = fontCss(px, "brat");
    const gap = Math.max(ctx.measureText(" ").width, px * 0.18) * BRAT_SX;
    const widths = labels.map((label) => ctx.measureText(label).width * BRAT_SX);
    const rows = wrapVisual(widths, target, gap);
    const naturals = rows.map((row) => {
      const sum = row.reduce((acc, i) => acc + (widths[i] ?? 0), 0);
      return sum + gap * Math.max(0, row.length - 1);
    });
    const longest = naturals.reduce((max, n) => Math.max(max, n), 0);
    const lh = px * 1.12;
    const rowCount = Math.max(1, rows.length);
    const fill = longest / Math.max(1, target);
    let score = Math.abs(fill - 1);
    if (longest > target * 1.04) score += (longest / target - 1) * 5;
    if (labels.length >= 3) {
      if (rowCount < 3) score += (3 - rowCount) * 0.5;
      if (rowCount > 5) score += (rowCount - 5) * 1;
      if (rowTarget) score += Math.abs(rowCount - rowTarget) * 0.25;
    }
    if (rowCount * lh > frameH * 0.7) score += 2;
    score -= px / 8000;
    if (!best || score < best.score) best = { score, px, gap, widths, rows, naturals, lh };
  }
  return best!;
}

function drawBrat(
  ctx: CanvasRenderingContext2D,
  lyrics: LyricLine[],
  time: number,
  w: number,
  h: number,
  prefs: CaptionPrefs,
  look?: { mode?: BratPlateMode; plate?: BratPlateId; position?: CaptionPosId; rows?: number },
) {
  const blocks = groupBratBlocks(bratTokens(lyrics));
  let active: BratTok[] | null = null;
  let began = 0;
  let until = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const start = block[0]!.start;
    const end = block[block.length - 1]!.end;
    const next = blocks[i + 1]?.[0]?.start;
    const stop = next == null ? end : Math.min(end, next);
    if (time >= start && time < stop) {
      active = block;
      began = start;
      until = stop;
      break;
    }
  }
  if (!active?.length) return;

  const mode = look?.mode ?? prefs.bratPlateMode ?? "full";
  const plate = look?.plate ?? prefs.bratPlate;
  const position = look?.position ?? "mid";
  const labels = active.map((word) => word.text);
  const plateW = mode === "block" ? w * 0.78 : w;
  const laid = chooseBrat(ctx, labels, plateW, h, look?.rows);
  const target = plateW * 0.85;
  const left = (w - target) / 2;
  const blockH = laid.rows.length * laid.lh;
  const y0 = yOrigin(position, h, blockH, laid.lh);
  const spots: { label: string; start: number; x: number; y: number }[] = [];
  laid.rows.forEach((row, ri) => {
    const sum = row.reduce((acc, i) => acc + (laid.widths[i] ?? 0), 0);
    const natural = laid.naturals[ri] ?? sum;
    const justify = row.length > 1 && natural >= target * 0.8 && natural <= target * 1.02;
    const useGap = justify ? (target - sum) / Math.max(1, row.length - 1) : laid.gap;
    let x = left;
    for (const i of row) {
      spots.push({ label: labels[i] ?? "", start: active![i]!.start, x, y: y0 + ri * laid.lh });
      x += (laid.widths[i] ?? 0) + useGap;
    }
  });

  let alpha = 1;
  if (prefs.bratFade) {
    const fade = 0.08;
    if (time - began < fade) alpha = Math.max(0, (time - began) / fade);
    if (until - time < fade) alpha = Math.min(alpha, Math.max(0, (until - time) / fade));
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  if (mode === "block") {
    const padY = laid.lh * 0.42;
    const top = y0 - laid.lh / 2;
    ctx.filter = "none";
    ctx.fillStyle = bratPlateColor(plate);
    ctx.fillRect((w - plateW) / 2, top - padY, plateW, blockH + padY * 2);
  }
  ctx.filter = `blur(${(1.2 * w) / 720}px)`;
  ctx.fillStyle = bratInk(plate);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = fontCss(laid.px, "brat");
  for (const spot of spots) {
    if (time < spot.start) continue;
    ctx.save();
    ctx.translate(spot.x, spot.y);
    ctx.scale(BRAT_SX, 1);
    ctx.fillText(spot.label, 0, 0);
    ctx.restore();
  }
  ctx.filter = "none";
  ctx.restore();
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
  const bratMode = recipe.bratPlateMode ?? prefs.bratPlateMode ?? "full";
  const bratPlate = recipe.bratPlate ?? prefs.bratPlate;
  const showFootage =
    recipe.captionStyle !== "brat" || bratMode === "block" || (recipe.bratPlateMode == null && prefs.bratFootage);
  const bratPlateOnly = recipe.captionStyle === "brat" && !showFootage;
  try {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = quality === "export" ? "high" : "low";
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.fillStyle = bratPlateOnly ? bratPlateColor(bratPlate) : "#0b0b0c";
  ctx.fillRect(0, 0, width, height);

  if (!bratPlateOnly) {
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

  if (recipe.captionStyle === "brat") {
    drawBrat(ctx, lyrics, time, width, height, prefs, {
      mode: bratMode,
      plate: bratPlate,
      position: recipe.bratPosition ?? "mid",
      rows: recipe.bratRows,
    });
  } else {
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
  }
  } catch {
    /* keep last frame rather than crash the studio */
  }
}
