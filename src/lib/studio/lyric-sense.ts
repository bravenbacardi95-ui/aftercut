import { MIN_WORD_DUR, type LyricWord } from "./types";
import { nextWordId, tokenizeLine } from "./lyrics";

function norm(text: string) {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function lev(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(cur + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n]!;
}

function closeTo(token: string, target: string, max = 1) {
  const a = norm(token);
  const b = norm(target);
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return lev(a, b) <= max;
}

const ORTHO: Record<string, string> = {
  gon: "gon'",
  imma: "I'ma",
  ima: "I'ma",
  yall: "y'all",
  aint: "ain't",
  cause: "'cause",
  cuz: "'cause",
};

/** Spelling only. Never substitutes another word, and never moves a timestamp. */
export function applyColloquialFixes(words: LyricWord[]): LyricWord[] {
  return words.map((w) => {
    const mapped = ORTHO[norm(w.text)];
    if (!mapped || mapped === w.text) return w;
    return { ...w, text: preserveCap(w.text, mapped) };
  });
}

export type PolishedWord = { text: string; from: number; to: number };

export function applyPolishMap(original: LyricWord[], map: PolishedWord[]): LyricWord[] {
  if (!map.length) return original;
  const out: LyricWord[] = [];
  for (const item of map) {
    const from = Math.max(0, Math.min(original.length - 1, item.from));
    const to = Math.max(from, Math.min(original.length - 1, item.to));
    const start = original[from]!.start;
    const end = Math.max(start + MIN_WORD_DUR, original[to]!.end);
    const tokens = tokenizeLine(item.text);
    if (!tokens.length) continue;
    out.push(...explodeTokens(tokens, start, end, original[from]!.line));
  }
  return stitch(out);
}

export function applyLyricRewrite(original: LyricWord[], lyric: string): LyricWord[] {
  const tokens = lyric
    .split(/\n/)
    .flatMap((line) => tokenizeLine(line))
    .filter(Boolean);
  if (tokens.length < 2 || !original.length) return original;
  if (tokens.length === original.length) {
    return original.map((w, i) => ({ ...w, text: tokens[i]! }));
  }
  const start = original[0]!.start;
  const end = Math.max(start + MIN_WORD_DUR * tokens.length, original[original.length - 1]!.end);
  const aligned: LyricWord[] = [];
  let i = 0;
  let j = 0;
  while (j < tokens.length && i < original.length) {
    const src = original[i]!;
    const token = tokens[j]!;
    const nxtSrc = original[i + 1];
    const nxtTok = tokens[j + 1];
    if (closeTo(src.text, token, 2) || norm(src.text) === norm(token)) {
      aligned.push({ ...src, text: token });
      i += 1;
      j += 1;
      continue;
    }
    if (nxtSrc && closeTo(nxtSrc.text, token, 1)) {
      i += 1;
      continue;
    }
    if (nxtTok && closeTo(src.text, nxtTok, 1)) {
      const mid = src.start + (src.end - src.start) / 2;
      aligned.push({ ...src, text: token, end: mid });
      j += 1;
      continue;
    }
    aligned.push({ ...src, text: token });
    i += 1;
    j += 1;
  }
  while (j < tokens.length) {
    const last = aligned[aligned.length - 1];
    const t0 = last?.end ?? start;
    const remain = Math.max(MIN_WORD_DUR, (end - t0) / Math.max(1, tokens.length - j));
    aligned.push({
      id: nextWordId(),
      text: tokens[j]!,
      start: t0,
      end: t0 + remain,
      line: last?.line ?? 0,
    });
    j += 1;
  }
  return stitch(aligned.length ? aligned : explodeTokens(tokens, start, end, original[0]!.line));
}

export function explodeTokens(tokens: string[], start: number, end: number, line: number): LyricWord[] {
  const span = Math.max(MIN_WORD_DUR * tokens.length, end - start);
  return tokens.map((text, i) => ({
    id: nextWordId(),
    text,
    start: start + (i / tokens.length) * span,
    end: start + ((i + 1) / tokens.length) * span,
    line,
  }));
}

function stitch(words: LyricWord[]): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      sorted[i] = { ...sorted[i]!, start: sorted[i - 1]!.end };
    }
    if (sorted[i]!.end <= sorted[i]!.start) {
      sorted[i] = { ...sorted[i]!, end: sorted[i]!.start + MIN_WORD_DUR };
    }
  }
  return sorted;
}

function preserveCap(original: string, next: string) {
  if (original === original.toUpperCase() && original.length > 1) return next.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return next[0] ? next[0].toUpperCase() + next.slice(1) : next;
  }
  return next;
}
