import { makeCuts } from "./beats";
import type { AudioAnalysis, CaptionEffectId, CaptionFontId, CaptionStyleId, FramingId, LookId, MediaClip, PacingId, Recipe, Region } from "./types";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function recipeKey(recipe: Pick<Recipe, "font" | "captionStyle" | "effect" | "look" | "framing" | "cuts" | "clipIds">) {
  return [
    recipe.font,
    recipe.captionStyle,
    recipe.effect,
    recipe.look,
    recipe.framing,
    recipe.cuts.map((cut) => cut.toFixed(3)).join(","),
    recipe.clipIds.join(","),
  ].join("|");
}

export function uniqueRecipeCount(recipes: Recipe[]) {
  return new Set(recipes.map(recipeKey)).size;
}

export function buildRecipes(opts: {
  count: number;
  styles: CaptionStyleId[];
  fonts: CaptionFontId[];
  effects: CaptionEffectId[];
  looks: LookId[];
  framings: FramingId[];
  pacing: PacingId;
  clipIds: string[];
  region: Region;
  analysis: AudioAnalysis;
}): Recipe[] {
  const styles = opts.styles.length ? opts.styles : (["line"] as CaptionStyleId[]);
  const fonts = opts.fonts.length ? opts.fonts : (["clean"] as CaptionFontId[]);
  const effects = opts.effects.length ? opts.effects : (["none"] as CaptionEffectId[]);
  const looks = opts.looks.length ? opts.looks : (["film"] as LookId[]);
  const framings = opts.framings.length ? opts.framings : (["fill"] as FramingId[]);
  const ids = opts.clipIds.length ? opts.clipIds : ["clip"];
  const combos: { style: CaptionStyleId; font: CaptionFontId; effect: CaptionEffectId; look: LookId; framing: FramingId }[] = [];
  for (const font of fonts) {
    for (const style of styles) {
      for (const look of looks) {
        for (const framing of framings) {
          for (const effect of effects) combos.push({ style, font, effect, look, framing });
        }
      }
    }
  }
  const recipes: Recipe[] = [];
  const used = new Set<string>();
  for (let i = 0; i < opts.count; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 48 && !placed; attempt++) {
      const combo = combos[(i + attempt) % combos.length]!;
      const seed = (1000 + i * 97 + attempt * 131 + combo.font.length * 17) >>> 0;
      const order = shuffle(
        Array.from({ length: ids.length }, (_, n) => n),
        seed,
      );
      const cuts = makeCuts(opts.analysis.beats, opts.region.start, opts.region.end, opts.pacing, opts.analysis, seed);
      const segments = Math.max(1, cuts.length - 1);
      const clipIds = Array.from({ length: segments }, (_, seg) => ids[order[seg % order.length]! % ids.length]!);
      const draft = {
        font: combo.font,
        captionStyle: combo.style,
        effect: combo.effect,
        look: combo.look,
        framing: combo.framing,
        cuts,
        clipIds,
      };
      const key = recipeKey(draft);
      if (used.has(key)) continue;
      used.add(key);
      recipes.push({
        id: `r${i}-${combo.style}-${combo.font}-${combo.effect}-${combo.look}-${combo.framing}`,
        index: i,
        captionStyle: combo.style,
        font: combo.font,
        effect: combo.effect,
        look: combo.look,
        framing: combo.framing,
        pacing: opts.pacing,
        seed,
        clipOrder: order,
        clipIds,
        cuts,
      });
      placed = true;
    }
  }
  return recipes;
}

export function buildSingleRecipe(opts: {
  clipIds: string[];
  region: Region;
  analysis: AudioAnalysis;
  style: CaptionStyleId;
  font: CaptionFontId;
  effect: CaptionEffectId;
  look: LookId;
  framing: FramingId;
}): Recipe {
  const ids = opts.clipIds.length ? opts.clipIds : ["clip"];
  const cuts = cutsForCount(opts.analysis.beats, opts.region.start, opts.region.end, ids.length);
  return {
    id: "single",
    index: 0,
    captionStyle: opts.style,
    font: opts.font,
    effect: opts.effect,
    look: opts.look,
    framing: opts.framing,
    pacing: "smart",
    seed: 1,
    clipOrder: ids.map((_, i) => i),
    clipIds: [...ids],
    cuts,
  };
}

function cutsForCount(beats: number[], start: number, end: number, count: number): number[] {
  const n = Math.max(1, count);
  if (n === 1) return [start, end];
  const span = Math.max(0.4, end - start);
  const targets = Array.from({ length: n - 1 }, (_, i) => start + (span * (i + 1)) / n);
  const used = new Set<number>();
  const marks = targets.map((target) => {
    let best = target;
    let dist = Infinity;
    for (const beat of beats) {
      if (beat <= start + 0.28 || beat >= end - 0.28 || used.has(beat)) continue;
      const d = Math.abs(beat - target);
      if (d < dist && d < span / n) {
        dist = d;
        best = beat;
      }
    }
    used.add(best);
    return best;
  });
  const cuts = [start, ...marks.sort((a, b) => a - b), end];
  for (let i = 1; i < cuts.length - 1; i++) {
    const min = cuts[i - 1]! + 0.28;
    const max = cuts[i + 1]! - 0.28;
    cuts[i] = Math.min(max, Math.max(min, cuts[i]!));
  }
  return cuts;
}

export function retargetRecipe(recipe: Recipe, region: Region, analysis: AudioAnalysis): Recipe {
  if (recipe.id === "single") {
    return {
      ...recipe,
      cuts: cutsForCount(analysis.beats, region.start, region.end, Math.max(1, recipe.clipIds.length || 1)),
    };
  }
  const cuts = makeCuts(analysis.beats, region.start, region.end, recipe.pacing, analysis, recipe.seed);
  const segments = Math.max(1, cuts.length - 1);
  const prev = recipe.clipIds.length ? recipe.clipIds : ["clip"];
  const clipIds = Array.from({ length: segments }, (_, i) => prev[i] ?? prev[i % prev.length]!);
  return { ...recipe, cuts, clipIds };
}

export function segmentIndexAt(cuts: number[], t: number): number {
  let i = 0;
  while (i < cuts.length - 1 && cuts[i + 1]! <= t) i++;
  return i;
}

export function clipForRecipe(recipe: Recipe, clips: MediaClip[], t: number): MediaClip | undefined {
  if (!clips.length) return undefined;
  const seg = segmentIndexAt(recipe.cuts ?? [], t);
  const ids = recipe.clipIds ?? [];
  const id = ids[seg] ?? ids[seg % Math.max(1, ids.length)];
  if (id) {
    const found = clips.find((c) => c.id === id);
    if (found) return found;
  }
  return clips[clipIndexAt(recipe, t, clips.length)] ?? clips[0];
}

export function moveCutTime(cuts: number[], index: number, time: number): number[] {
  if (index <= 0 || index >= cuts.length - 1) return cuts;
  const min = cuts[index - 1]! + 0.22;
  const max = cuts[index + 1]! - 0.22;
  if (max <= min) return cuts;
  const next = [...cuts];
  next[index] = Math.min(max, Math.max(min, time));
  return next;
}

export function splitCuts(cuts: number[], clipIds: string[], time: number): { cuts: number[]; clipIds: string[] } | null {
  if (cuts.length < 2) return null;
  const i = segmentIndexAt(cuts, time);
  const start = cuts[i]!;
  const end = cuts[i + 1] ?? start;
  if (time - start < 0.22 || end - time < 0.22) return null;
  const id = clipIds[i] ?? clipIds[0] ?? "";
  return {
    cuts: [...cuts.slice(0, i + 1), time, ...cuts.slice(i + 1)],
    clipIds: [...clipIds.slice(0, i + 1), id, ...clipIds.slice(i + 1)],
  };
}

export function moveSegmentTo(
  cuts: number[],
  clipIds: string[],
  from: number,
  dropTime: number,
): { cuts: number[]; clipIds: string[] } | null {
  if (from < 0 || from >= clipIds.length || cuts.length < 2) return null;
  const origin = cuts[0] ?? 0;
  const segs = clipIds.map((id, i) => ({
    id,
    dur: Math.max(0.22, (cuts[i + 1] ?? origin) - (cuts[i] ?? origin)),
  }));
  const moved = segs[from];
  if (!moved) return null;
  const start = cuts[from] ?? origin;
  const end = start + moved.dur;
  let t = dropTime;
  if (dropTime >= end) t = dropTime - moved.dur;
  else if (dropTime >= start) return { cuts: [...cuts], clipIds: [...clipIds] };
  const rest = segs.filter((_, i) => i !== from);
  let insert = rest.length;
  let cursor = origin;
  for (let i = 0; i < rest.length; i++) {
    const mid = cursor + rest[i]!.dur / 2;
    if (t < mid) {
      insert = i;
      break;
    }
    cursor += rest[i]!.dur;
  }
  rest.splice(insert, 0, moved);
  const nextCuts = [origin];
  for (const seg of rest) nextCuts.push(nextCuts[nextCuts.length - 1]! + seg.dur);
  return { cuts: nextCuts, clipIds: rest.map((seg) => seg.id) };
}

export function removeCutAt(cuts: number[], clipIds: string[], index: number): { cuts: number[]; clipIds: string[] } | null {
  if (index <= 0 || index >= cuts.length - 1) return null;
  return {
    cuts: cuts.filter((_, i) => i !== index),
    clipIds: clipIds.filter((_, i) => i !== index),
  };
}

export function clipIndexAt(recipe: Recipe, t: number, clipCount: number): number {
  const cuts = recipe.cuts;
  let i = 0;
  while (i < cuts.length - 1 && cuts[i + 1] <= t) i++;
  if (!clipCount) return 0;
  return recipe.clipOrder[i % recipe.clipOrder.length] % clipCount;
}