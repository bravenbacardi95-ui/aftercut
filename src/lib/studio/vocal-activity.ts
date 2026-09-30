import { getDecodedAudio } from "./audio-clip.ts";
import type { LyricWord, Region } from "./types";
import { yieldToPaint } from "./yield.ts";

export type VocalAtom = { start: number; end: number };

const PHRASE_GAP = 0.18;

export async function anchorWords(words: LyricWord[], region: Region): Promise<LyricWord[]> {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length < 2) return sorted;
  const atoms = (await singingAtomsAsync(region)).filter((atom) => atom.end > region.start + 0.02 && atom.start < region.end - 0.02);
  if (atoms.length < 1) return sorted;

  const shift = bestShift(sorted, atoms);
  const shifted =
    shift === 0
      ? sorted
      : sorted.map((word) => ({
          ...word,
          start: clamp(word.start + shift, region.start, region.end - 0.05),
          end: clamp(word.end + shift, region.start, region.end),
        }));

  if (hitRate(shifted, atoms) >= 0.4) {
    const snapped = trySnap(shifted, atoms, region);
    if (snapped && snapped.length >= Math.ceil(shifted.length * 0.65)) return separate(snapped);
  }
  const sung = alignBySyllable(shifted, atoms, region);
  return sung.length ? separate(sung) : separate(layoutOnAtoms(shifted, atoms, region));
}

function hitRate(words: LyricWord[], atoms: VocalAtom[]) {
  let hits = 0;
  for (const word of words) {
    const mid = (word.start + word.end) / 2;
    if (atoms.some((atom) => mid >= atom.start - 0.05 && mid <= atom.end + 0.05)) hits += 1;
  }
  return hits / words.length;
}

function bestShift(words: LyricWord[], atoms: VocalAtom[]) {
  const mids = words.map((word) => (word.start + word.end) / 2);
  const score = (shift: number) => {
    let hits = 0;
    for (const mid of mids) {
      const t = mid + shift;
      for (const atom of atoms) {
        if (t >= atom.start - 0.04 && t <= atom.end + 0.04) {
          hits += 1;
          break;
        }
      }
    }
    return hits;
  };
  const base = score(0);
  let best = 0;
  let hits = base;
  for (let step = -80; step <= 80; step++) {
    const shift = step * 0.025;
    const next = score(shift);
    if (next > hits) {
      hits = next;
      best = shift;
    }
  }
  if (hits < base + 2 || hits < words.length * 0.45) return 0;
  return best;
}

function alignBySyllable(words: LyricWord[], atoms: VocalAtom[], region: Region): LyricWord[] {
  const count = words.length;
  const atomCount = atoms.length;
  if (!count || !atomCount) return [];
  const inf = 1e12;
  const cost = Array.from({ length: count + 1 }, () => new Float64Array(atomCount + 1).fill(inf));
  const takeAt = Array.from({ length: count + 1 }, () => new Int16Array(atomCount + 1));
  const fromAt = Array.from({ length: count + 1 }, () => new Int16Array(atomCount + 1).fill(-1));
  for (let atom = 0; atom <= atomCount; atom++) cost[0]![atom] = atom * 0.05;

  for (let i = 0; i < count; i++) {
    const syl = syllables(words[i]!.text);
    for (let atom = 0; atom < atomCount; atom++) {
      const base = cost[i]![atom] ?? inf;
      if (base >= inf / 2) continue;
      const skipped = base + 0.2;
      if (skipped < (cost[i]![atom + 1] ?? inf)) cost[i]![atom + 1] = skipped;
      const maxTake = Math.min(atomCount - atom, syl + 2);
      for (let take = 1; take <= maxTake; take++) {
        const start = atoms[atom]!.start;
        const end = atoms[atom + take - 1]!.end;
        const dur = Math.max(0.01, end - start);
        const ideal = syl * 0.26;
        const lo = Math.max(0.05, syl * 0.08);
        const hi = syl * 0.6 + 0.1;
        let penalty = Math.abs(dur - ideal) * 0.45 + Math.abs(take - syl) * 0.5;
        if (dur < lo) penalty += (lo - dur) * 9;
        if (dur > hi) penalty += (dur - hi) * 5;
        const next = base + penalty;
        const dest = atom + take;
        if (next < (cost[i + 1]![dest] ?? inf)) {
          cost[i + 1]![dest] = next;
          takeAt[i + 1]![dest] = take;
          fromAt[i + 1]![dest] = atom;
        }
      }
    }
  }

  let atom = 0;
  let best = inf;
  for (let index = 0; index <= atomCount; index++) {
    const total = (cost[count]![index] ?? inf) + (atomCount - index) * 0.05;
    if (total < best) {
      best = total;
      atom = index;
    }
  }
  if (best >= inf / 2) return [];

  const placed: Array<{ start: number; end: number } | null> = new Array(count).fill(null);
  let word = count;
  while (word > 0) {
    const take = takeAt[word]![atom] ?? 0;
    const from = fromAt[word]![atom] ?? -1;
    if (take < 1 || from < 0) return [];
    const start = Math.max(region.start, atoms[from]!.start);
    const end = Math.min(region.end, atoms[from + take - 1]!.end);
    if (end - start < 0.04) return [];
    placed[word - 1] = { start, end };
    atom = from;
    word -= 1;
  }
  return words.map((item, index) => {
    const span = placed[index];
    return span ? { ...item, start: span.start, end: span.end } : item;
  });
}

export function lockWordsToSinging(words: LyricWord[], region: Region): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  if (!sorted.length) return [];
  const atoms = singingAtoms(region);
  if (atoms.length < 1) return sorted;
  const seated = sorted.filter((word) => {
    const mid = (word.start + word.end) / 2;
    return atoms.some((atom) => mid >= atom.start - 0.04 && mid <= atom.end + 0.04);
  }).length;
  const snapped = seated * 2 >= sorted.length ? trySnap(sorted, atoms, region) : null;
  const locked = snapped ?? layoutOnAtoms(sorted, atoms, region);
  return separate(locked);
}

export async function singingAtomsAsync(region: Region): Promise<VocalAtom[]> {
  const audio = getDecodedAudio();
  if (!audio) return [];
  const sr = audio.sampleRate;
  const t0 = Math.max(0, region.start);
  const t1 = Math.min(audio.duration, region.end);
  if (t1 - t0 < 0.35) return [];
  const channels = audio.numberOfChannels;
  const buffers: Float32Array[] = [];
  for (let c = 0; c < channels; c++) buffers.push(audio.getChannelData(c));
  const i0 = Math.floor(t0 * sr);
  const i1 = Math.min(buffers[0]!.length, Math.ceil(t1 * sr));
  const hop = Math.max(1, Math.round(sr * 0.01));
  const frames = Math.ceil((i1 - i0) / hop);
  if (frames < 8) return [];
  const mid = new Float32Array(frames);
  const presence = new Float32Array(frames);
  const hpA = Math.exp((-2 * Math.PI * 260) / sr);
  const lpA = 1 - Math.exp((-2 * Math.PI * 3600) / sr);
  const bassA = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let hp = 0;
  let lp = 0;
  let bass = 0;
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    if ((f & 31) === 0) await yieldToPaint();
    const from = i0 + f * hop;
    const to = Math.min(i1, from + hop);
    let midAcc = 0;
    let bassAcc = 0;
    let n = 0;
    for (let j = from; j < to; j += 4) {
      let x = 0;
      for (let c = 0; c < channels; c++) x += buffers[c]![j] ?? 0;
      x /= channels;
      hp = hpA * (hp + x - prev);
      prev = x;
      lp += lpA * (hp - lp);
      bass += bassA * (x - bass);
      midAcc += lp * lp;
      bassAcc += bass * bass;
      n++;
    }
    const m = Math.sqrt(midAcc / Math.max(1, n));
    const low = Math.sqrt(bassAcc / Math.max(1, n));
    mid[f] = m;
    presence[f] = m * (m / (m + low * 2.4 + 1e-8));
  }
  const smoothMid = smooth3(mid);
  const smoothPresence = smooth3(presence);
  const contrast = percentile(smoothPresence, 0.9) / (percentile(smoothPresence, 0.28) + 1e-8);
  const env = contrast < 1.45 ? smoothMid : smoothPresence;
  return atomsFromEnvelope(env, hop / sr, t0);
}

export function singingAtoms(region: Region): VocalAtom[] {
  const audio = getDecodedAudio();
  if (!audio) return [];
  const sr = audio.sampleRate;
  const t0 = Math.max(0, region.start);
  const t1 = Math.min(audio.duration, region.end);
  if (t1 - t0 < 0.35) return [];

  const channels = audio.numberOfChannels;
  const buffers: Float32Array[] = [];
  for (let c = 0; c < channels; c++) buffers.push(audio.getChannelData(c));
  const i0 = Math.floor(t0 * sr);
  const i1 = Math.min(buffers[0]!.length, Math.ceil(t1 * sr));
  const hop = Math.max(1, Math.round(sr * 0.01));
  const frames = Math.ceil((i1 - i0) / hop);
  if (frames < 8) return [];

  const mid = new Float32Array(frames);
  const presence = new Float32Array(frames);
  const hpA = Math.exp((-2 * Math.PI * 260) / sr);
  const lpA = 1 - Math.exp((-2 * Math.PI * 3600) / sr);
  const bassA = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let hp = 0;
  let lp = 0;
  let bass = 0;
  let prev = 0;

  for (let f = 0; f < frames; f++) {
    const from = i0 + f * hop;
    const to = Math.min(i1, from + hop);
    let midAcc = 0;
    let bassAcc = 0;
    let n = 0;
    for (let j = from; j < to; j += 4) {
      let x = 0;
      for (let c = 0; c < channels; c++) x += buffers[c]![j] ?? 0;
      x /= channels;
      hp = hpA * (hp + x - prev);
      prev = x;
      lp += lpA * (hp - lp);
      bass += bassA * (x - bass);
      midAcc += lp * lp;
      bassAcc += bass * bass;
      n++;
    }
    const m = Math.sqrt(midAcc / Math.max(1, n));
    const low = Math.sqrt(bassAcc / Math.max(1, n));
    mid[f] = m;
    presence[f] = m * (m / (m + low * 2.4 + 1e-8));
  }

  const smoothMid = smooth3(mid);
  const smoothPresence = smooth3(presence);
  const contrast = percentile(smoothPresence, 0.9) / (percentile(smoothPresence, 0.28) + 1e-8);
  const env = contrast < 1.45 ? smoothMid : smoothPresence;
  return atomsFromEnvelope(env, hop / sr, t0);
}

export function atomsFromEnvelope(env: Float32Array, hop: number, t0: number): VocalAtom[] {
  const n = env.length;
  if (n < 4 || hop <= 0) return [];
  const floor = percentile(env, 0.3);
  const peak = percentile(env, 0.9);
  if (peak <= floor * 1.12) return [];
  const onset = floor + (peak - floor) * 0.36;
  const offset = floor + (peak - floor) * 0.18;
  const hang = Math.max(1, Math.round(0.09 / hop));

  const phrases: Array<{ start: number; end: number }> = [];
  let open = false;
  let startF = 0;
  let lastLoud = 0;
  let below = 0;
  for (let f = 0; f < n; f++) {
    const hot = (env[f] ?? 0) >= (open ? offset : onset);
    if (!open) {
      if (!hot) continue;
      open = true;
      startF = f;
      lastLoud = f;
      below = 0;
      continue;
    }
    if (hot) {
      lastLoud = f;
      below = 0;
      continue;
    }
    below += 1;
    if (below > hang) {
      phrases.push({ start: startF, end: lastLoud });
      open = false;
    }
  }
  if (open) phrases.push({ start: startF, end: lastLoud });

  const atoms: VocalAtom[] = [];
  for (const phrase of phrases) {
    if (isClick(env, phrase.start, phrase.end, hop)) continue;
    const parts = splitPhrase(env, phrase.start, phrase.end, hop, offset);
    for (const part of parts) {
      if (isClick(env, part.start, part.end, hop)) continue;
      const start = t0 + part.start * hop;
      const end = t0 + (part.end + 1) * hop;
      if (end - start >= 0.06) atoms.push({ start, end });
    }
  }

  const kept = atoms.filter((atom, i) => {
    if (atom.end - atom.start >= 0.08) return true;
    const prev = atoms[i - 1];
    const next = atoms[i + 1];
    return (prev && atom.start - prev.end < 0.22) || (next && next.start - atom.end < 0.22);
  });

  for (let i = 0; i < kept.length; i++) {
    const prevEnd = i > 0 ? kept[i - 1]!.end : t0;
    kept[i] = {
      start: Math.max(prevEnd, kept[i]!.start - 0.02),
      end: kept[i]!.end,
    };
  }
  return mergeTinyGaps(kept, 0.028);
}

export function trySnap(words: LyricWord[], atoms: VocalAtom[], region: Region): LyricWord[] | null {
  if (!atoms.length || !words.length) return null;
  const chosen: number[] = new Array(words.length).fill(-1);
  let hits = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const mid = (word.start + word.end) / 2;
    let best = -1;
    let bestD = 0.32;
    for (let a = 0; a < atoms.length; a++) {
      const atom = atoms[a]!;
      const inside = mid >= atom.start - 0.06 && mid <= atom.end + 0.06;
      const d = inside ? 0 : Math.abs(mid - clamp(mid, atom.start, atom.end));
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best >= 0 && bestD <= 0.28) {
      chosen[i] = best;
      hits += 1;
    }
  }
  if (hits < Math.max(2, Math.ceil(words.length * 0.45))) return null;

  for (let i = 1; i < chosen.length; i++) {
    if (chosen[i]! >= 0 && chosen[i - 1]! >= 0 && chosen[i]! < chosen[i - 1]!) chosen[i] = chosen[i - 1]!;
  }
  for (let i = 0; i < chosen.length; i++) {
    if (chosen[i] !== -1) continue;
    let prev = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (chosen[j] !== -1) {
        prev = chosen[j]!;
        break;
      }
    }
    let next = -1;
    for (let j = i + 1; j < chosen.length; j++) {
      if (chosen[j] !== -1) {
        next = chosen[j]!;
        break;
      }
    }
    chosen[i] = prev >= 0 ? prev : next;
  }
  if (chosen.some((index) => index < 0)) return null;

  const out: LyricWord[] = [];
  let i = 0;
  while (i < words.length) {
    const atomIndex = chosen[i]!;
    let j = i + 1;
    while (j < words.length && chosen[j] === atomIndex) j += 1;
    const group = words.slice(i, j);
    const atom = atoms[atomIndex]!;
    const spans = splitSpan(
      clamp(atom.start, region.start, region.end),
      clamp(atom.end, region.start, region.end),
      group.map((word) => syllables(word.text)),
    );
    group.forEach((word, k) => {
      const span = spans[k];
      if (!span || span.end <= span.start) return;
      out.push({ ...word, start: span.start, end: span.end });
    });
    i = j;
  }
  return out.length ? out : null;
}

export function layoutOnAtoms(words: LyricWord[], atoms: VocalAtom[], region: Region): LyricWord[] {
  const usable = atoms
    .map((atom) => ({ start: Math.max(region.start, atom.start), end: Math.min(region.end, atom.end) }))
    .filter((atom) => atom.end - atom.start >= 0.05)
    .sort((a, b) => a.start - b.start);
  if (!usable.length || !words.length) return words;

  const phrases: VocalAtom[][] = [];
  for (const atom of usable) {
    const phrase = phrases[phrases.length - 1];
    const last = phrase?.[phrase.length - 1];
    if (!phrase || !last || atom.start - last.end > PHRASE_GAP) phrases.push([atom]);
    else phrase.push(atom);
  }

  const weights = phrases.map((phrase) => phrase.reduce((sum, atom) => sum + (atom.end - atom.start), 0));
  const counts = apportion(words.length, weights);
  const out: LyricWord[] = [];
  let wi = 0;
  phrases.forEach((phrase, index) => {
    const count = counts[index] ?? 0;
    if (count <= 0) return;
    const slice = words.slice(wi, wi + count);
    wi += count;
    out.push(...placeInPhrase(slice, phrase));
  });
  if (wi < words.length && phrases.length) {
    const last = phrases[phrases.length - 1]!;
    const already = counts[phrases.length - 1] ?? 0;
    const slice = words.slice(Math.max(0, wi - already));
    const placed = placeInPhrase(slice, last);
    out.splice(Math.max(0, out.length - already), already, ...placed);
  }
  return out.filter((word) => word.end > word.start + 0.03 && word.start < region.end && word.end > region.start);
}

function placeInPhrase(slice: LyricWord[], atoms: VocalAtom[]): LyricWord[] {
  if (!slice.length) return [];
  if (atoms.length >= slice.length) {
    const quota = slice.map(() => 1);
    let left = atoms.length - slice.length;
    const syl = slice.map((word) => syllables(word.text));
    for (let i = 0; i < slice.length && left > 0; i++) {
      const give = Math.min(left, Math.max(0, syl[i]! - 1));
      quota[i] = (quota[i] ?? 1) + give;
      left -= give;
    }
    quota[quota.length - 1] = (quota[quota.length - 1] ?? 1) + left;
    let cursor = 0;
    return slice.map((word, index) => {
      const take = quota[index] ?? 1;
      const chunk = atoms.slice(cursor, cursor + take);
      cursor += take;
      const start = chunk[0]?.start ?? atoms[0]!.start;
      const end = chunk[chunk.length - 1]?.end ?? start + 0.08;
      return { ...word, start, end };
    });
  }

  const counts = apportion(slice.length, atoms.map((atom) => atom.end - atom.start));
  const out: LyricWord[] = [];
  let wi = 0;
  atoms.forEach((atom, index) => {
    const count = counts[index] ?? 0;
    if (count <= 0) return;
    const group = slice.slice(wi, wi + count);
    wi += count;
    const spans = splitSpan(
      atom.start,
      atom.end,
      group.map((word) => syllables(word.text)),
    );
    group.forEach((word, k) => {
      const span = spans[k];
      if (span) out.push({ ...word, start: span.start, end: span.end });
    });
  });
  return out;
}

function splitPhrase(
  env: Float32Array,
  start: number,
  end: number,
  hop: number,
  offset: number,
): Array<{ start: number; end: number }> {
  const minDist = Math.max(2, Math.round(0.08 / hop));
  const peaks: number[] = [];
  for (let f = start + 1; f < end; f++) {
    const value = env[f] ?? 0;
    if (value < offset) continue;
    if (value < (env[f - 1] ?? 0) || value < (env[f + 1] ?? 0)) continue;
    const prev = peaks[peaks.length - 1];
    if (prev !== undefined && f - prev < minDist) {
      if (value > (env[prev] ?? 0)) peaks[peaks.length - 1] = f;
      continue;
    }
    peaks.push(f);
  }
  if (peaks.length <= 1) return [{ start, end }];

  const cuts = [start];
  for (let f = start + 2; f < end - 1; f++) {
    const value = env[f] ?? 0;
    const rise = value - (env[f - 2] ?? 0);
    if (value < offset || rise < Math.max(offset * 0.5, value * 0.28)) continue;
    const prev = cuts[cuts.length - 1]!;
    if (f - prev < minDist) continue;
    cuts.push(Math.max(start + 1, f - 1));
  }
  for (let i = 1; i < peaks.length; i++) {
    const left = peaks[i - 1]!;
    const right = peaks[i]!;
    let valley = left;
    let lowest = Infinity;
    for (let f = left; f <= right; f++) {
      const value = env[f] ?? 0;
      if (value < lowest) {
        lowest = value;
        valley = f;
      }
    }
    const shoulder = Math.min(env[left] ?? 0, env[right] ?? 0);
    if (lowest > shoulder * 0.72) continue;
    const prev = cuts[cuts.length - 1]!;
    if (valley - prev < minDist) continue;
    cuts.push(valley);
  }
  cuts.push(end);
  cuts.sort((a, b) => a - b);
  const parts: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (b - a < minDist) continue;
    parts.push({ start: a, end: b });
  }
  return parts.length ? parts : [{ start, end }];
}

function splitSpan(start: number, end: number, weights: number[]): Array<{ start: number; end: number }> {
  const dur = Math.max(0.05, end - start);
  const safe = weights.map((weight) => Math.max(1, weight));
  const total = safe.reduce((sum, weight) => sum + weight, 0);
  let cursor = start;
  return safe.map((weight, index) => {
    const next = index === safe.length - 1 ? start + dur : cursor + (dur * weight) / total;
    const span = { start: cursor, end: Math.max(cursor + 0.04, next) };
    cursor = span.end;
    return span;
  });
}

function apportion(count: number, weights: number[]): number[] {
  if (!weights.length) return [];
  if (count <= 0) return weights.map(() => 0);
  const safe = weights.map((weight) => Math.max(0.001, weight));
  const sum = safe.reduce((total, weight) => total + weight, 0);
  const raw = safe.map((weight) => (count * weight) / sum);
  const base = raw.map((value) => Math.floor(value));
  let left = count - base.reduce((total, value) => total + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const item of order) {
    if (left <= 0) break;
    base[item.index] = (base[item.index] ?? 0) + 1;
    left -= 1;
  }
  if (count >= base.length) {
    for (let i = 0; i < base.length; i++) {
      if ((base[i] ?? 0) > 0) continue;
      let donor = 0;
      for (let j = 1; j < base.length; j++) if ((base[j] ?? 0) > (base[donor] ?? 0)) donor = j;
      if ((base[donor] ?? 0) > 1) {
        base[donor] = (base[donor] ?? 1) - 1;
        base[i] = 1;
      }
    }
  }
  return base;
}

function syllables(text: string): number {
  const word = text.toLowerCase().replace(/[^a-z']/g, "");
  if (!word) return 1;
  const groups = word.match(/[aeiouy]+/g);
  let count = groups?.length ?? 1;
  if (word.endsWith("e") && count > 1 && !word.endsWith("le")) count -= 1;
  return Math.max(1, Math.min(4, count));
}

function isClick(env: Float32Array, start: number, end: number, hop: number): boolean {
  let peak = 0;
  for (let f = start; f <= end; f++) peak = Math.max(peak, env[f] ?? 0);
  if (peak <= 0) return true;
  let held = 0;
  for (let f = start; f <= end; f++) if ((env[f] ?? 0) > peak * 0.45) held += 1;
  return held * hop < 0.05;
}

function mergeTinyGaps(atoms: VocalAtom[], gap: number): VocalAtom[] {
  const out: VocalAtom[] = [];
  for (const atom of atoms) {
    const prev = out[out.length - 1];
    const hole = prev ? atom.start - prev.end : Infinity;
    const together = prev ? atom.end - prev.start : 0;
    if (prev && hole > 0 && hole <= gap && together < 0.16) prev.end = atom.end;
    else out.push({ ...atom });
  }
  return out;
}

function separate(words: LyricWord[]): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start >= prev.end) continue;
    sorted[i - 1] = { ...prev, end: Math.max(prev.start + 0.04, Math.min(prev.end, cur.start)) };
  }
  return sorted.filter((word) => word.end > word.start + 0.03);
}

function smooth3(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const a = values[Math.max(0, i - 1)] ?? 0;
    const b = values[i] ?? 0;
    const c = values[Math.min(values.length - 1, i + 1)] ?? 0;
    out[i] = (a + b * 2 + c) / 4;
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
