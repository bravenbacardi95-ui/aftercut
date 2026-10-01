import { MIN_WORD_DUR, type LyricLine, type LyricWord, type Region } from "./types";

let seq = 1;
export function nextWordId(): string {
  seq += 1;
  return `w${seq.toString(36)}`;
}

export function parseLyricText(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function tokenizeLine(line: string): string[] {
  return line.split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

export function groupByAuthoredLine(words: LyricWord[]): LyricLine[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.line - b.line || a.start - b.start);
  const groups: LyricWord[][] = [];
  for (const word of sorted) {
    const prev = groups[groups.length - 1];
    if (!prev || prev[0]!.line !== word.line) groups.push([word]);
    else prev.push(word);
  }
  return groups.map((group, i) => {
    const tagged = group.map((word) => ({ ...word, line: i }));
    return {
      id: `ln-${i}-${tagged[0]!.id}`,
      text: tagged.map((word) => word.text).join(" "),
      start: tagged[0]!.start,
      end: tagged[tagged.length - 1]!.end,
      words: tagged,
    };
  });
}

function shownWord(text: string) {
  const stripped = text.replace(/[.,!?;:…]+$/g, "");
  return stripped.length ? stripped : text;
}

const LINE_CAP = 8;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function gapAt(words: LyricWord[], index: number) {
  return words[index]!.start - words[index - 1]!.end;
}

/** A pause is a break when it is clearly larger than the gaps inside the phrase, not when it clears a fixed 0.6s. */
function clearPause(words: LyricWord[], index: number) {
  const gap = gapAt(words, index);
  if (!(gap > 0)) return false;
  const samples: number[] = [];
  const lo = Math.max(1, index - 8);
  const hi = Math.min(words.length - 1, index + 8);
  for (let k = lo; k <= hi; k++) {
    if (k === index) continue;
    const other = gapAt(words, k);
    if (other > 0) samples.push(other);
  }
  if (!samples.length) return false;
  const lower = [...samples].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(samples.length * 0.6)));
  const base = median(lower);
  return gap > base * 2 && gap >= base + 0.12;
}

function splitAtBiggestGap(group: LyricWord[]): LyricWord[][] {
  if (group.length <= LINE_CAP) return [group];
  let maxGap = -Infinity;
  for (let i = 1; i < group.length; i++) maxGap = Math.max(maxGap, Math.max(0, gapAt(group, i)));
  let best = 1;
  let bestDist = Infinity;
  for (let i = 1; i < group.length; i++) {
    if (Math.max(0, gapAt(group, i)) < maxGap - 1e-6) continue;
    const dist = Math.abs(i - group.length / 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return [...splitAtBiggestGap(group.slice(0, best)), ...splitAtBiggestGap(group.slice(best))];
}

export function groupWordsIntoLines(words: LyricWord[]): LyricLine[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  const phrases: LyricWord[][] = [];
  let cur: LyricWord[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const word = sorted[i]!;
    const prev = cur[cur.length - 1];
    if (prev && (word.line !== prev.line || clearPause(sorted, i))) {
      phrases.push(cur);
      cur = [word];
    } else {
      cur.push(word);
    }
  }
  if (cur.length) phrases.push(cur);

  const groups = phrases.flatMap((phrase) => splitAtBiggestGap(phrase));
  return groups.map((group, i) => {
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const tagged = group.map((w) => ({ ...w, text: shownWord(w.text), line: i }));
    return {
      id: `ln-${i}-${tagged[0]!.id}`,
      text: tagged.map((w) => w.text).join(" "),
      start,
      end,
      words: tagged,
    };
  });
}

export function linesToDraft(lines: LyricLine[]): string {
  return lines.map((l) => l.text).join("\n");
}

export function wordsToDraft(words: LyricWord[]): string {
  return linesToDraft(groupByAuthoredLine(words));
}

export function explodeLine(text: string, start: number, end: number, line: number): LyricWord[] {
  const tokens = tokenizeLine(text);
  if (!tokens.length) return [];
  const span = Math.max(MIN_WORD_DUR * tokens.length, end - start);
  const t0 = start;
  return tokens.map((token, i) => ({
    id: nextWordId(),
    text: token,
    start: t0 + (i / tokens.length) * span,
    end: t0 + ((i + 1) / tokens.length) * span,
    line,
  }));
}

export function timeLyrics(lines: string[], beats: number[], start: number, end: number): LyricLine[] {
  const words = alignWordsToBeats(
    lines.flatMap((line, i) => tokenizeLine(line).map((text) => ({ text, line: i }))),
    beats,
    start,
    end,
  );
  return groupWordsIntoLines(words);
}

export function alignWordsToBeats(
  tokens: { text: string; line: number }[],
  anchors: number[],
  start: number,
  end: number,
): LyricWord[] {
  if (!tokens.length) return [];
  const span = Math.max(0.8, end - start);
  const inRange = anchors.filter((b) => b >= start && b < end);
  const placed = tokens.map((token, i) => {
    const even = start + (i / tokens.length) * span;
    const snapped = inRange.length ? snapTime(even, inRange, Math.max(0.08, span / tokens.length / 2)) : even;
    return { token, start: Math.max(start, Math.min(end - MIN_WORD_DUR, snapped)) };
  });
  if (placed[0]) placed[0].start = start;
  for (let i = 1; i < placed.length; i++) {
    if (placed[i].start <= placed[i - 1].start + MIN_WORD_DUR) {
      placed[i].start = placed[i - 1].start + Math.max(MIN_WORD_DUR, span / tokens.length);
    }
  }
  return placed.map((item, i) => {
    const next = placed[i + 1]?.start ?? end;
    const hold = Math.max(MIN_WORD_DUR, next - item.start - 0.02);
    return {
      id: nextWordId(),
      text: item.token.text,
      start: item.start,
      end: Math.min(end, item.start + hold),
      line: item.token.line,
    };
  });
}

export function wordsFromStt(
  raw: { text: string; start: number; end: number }[],
  offset = 0,
): LyricWord[] {
  const cleaned: { text: string; start: number; end: number }[] = [];
  for (const w of raw) {
    const start = w.start + offset;
    const end = Math.max(start + MIN_WORD_DUR, w.end + offset);
    const parts = tokenizeLine(w.text.replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, ""));
    if (!parts.length) continue;
    if (parts.length === 1) {
      if (/[\p{L}\p{N}]/u.test(parts[0]!)) cleaned.push({ text: parts[0]!, start, end });
      continue;
    }
    const weights = parts.map((token) => Math.max(1, [...token].length));
    const total = weights.reduce((sum, n) => sum + n, 0);
    const span = Math.max(MIN_WORD_DUR * parts.length, end - start);
    let cursor = 0;
    parts.forEach((token, i) => {
      if (!/[\p{L}\p{N}]/u.test(token)) return;
      const share = (weights[i] ?? 1) / total;
      const wordStart = start + cursor * span;
      cursor += share;
      cleaned.push({ text: token, start: wordStart, end: start + cursor * span });
    });
  }
  return cleaned.map((w) => ({
    id: nextWordId(),
    text: w.text,
    start: w.start,
    end: w.end,
    line: 0,
  }));
}

export function snapWordsToOnsets(words: LyricWord[], onsets: number[], thresh = 0.08): LyricWord[] {
  if (!onsets.length) return words;
  return words.map((w) => {
    let best = w.start;
    let dist = thresh;
    for (const o of onsets) {
      const d = Math.abs(o - w.start);
      if (d < dist) {
        dist = d;
        best = o;
      }
    }
    const delta = best - w.start;
    if (delta === 0) return w;
    const dur = w.end - w.start;
    return { ...w, start: best, end: best + dur };
  });
}

export function snapTime(t: number, points: number[], thresh = 0.025): number {
  if (!points.length) return t;
  let best = t;
  let dist = thresh;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

export function wordsInRegion(words: LyricWord[], region: Region): LyricWord[] {
  return words.filter((w) => w.end > region.start && w.start < region.end);
}

export function activeLyric(lines: LyricLine[], t: number): LyricLine | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (t >= line.start && t < line.end) return line;
  }
  return null;
}

export function activeWord(words: LyricWord[], t: number): LyricWord | null {
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (t >= w.start && t < w.end) return w;
  }
  return null;
}

export function applyDraft(oldWords: LyricWord[], text: string, region: Region): LyricWord[] {
  const newLines = parseLyricText(text).map(tokenizeLine).filter((l) => l.length);
  if (!newLines.length) return [];
  const oldLines = groupByAuthoredLine(oldWords);
  const result: LyricWord[] = [];

  newLines.forEach((tokens, i) => {
    const old = oldLines[i];
    const fallbackStart = result.length ? result[result.length - 1].end + 0.12 : region.start;
    const start = old?.start ?? fallbackStart;
    const end = old?.end ?? Math.min(region.end, start + Math.max(0.7, tokens.length * 0.32));

    if (old && old.words.length === tokens.length) {
      tokens.forEach((token, j) => {
        result.push({ ...old.words[j], text: token, line: i });
      });
      return;
    }

    const span = Math.max(MIN_WORD_DUR * tokens.length, end - start);
    tokens.forEach((token, j) => {
      const existing = old?.words[j];
      result.push({
        id: existing?.id ?? nextWordId(),
        text: token,
        start: start + (j / tokens.length) * span,
        end: start + ((j + 1) / tokens.length) * span,
        line: i,
      });
    });
  });

  return result;
}

export function resizeWord(
  words: LyricWord[],
  id: string,
  edge: "start" | "end",
  time: number,
  push = true,
): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((w) => w.id === id);
  if (i < 0) return words;
  const cur = sorted[i];
  let start = cur.start;
  let end = cur.end;
  if (edge === "start") start = Math.min(time, end - MIN_WORD_DUR);
  else end = Math.max(time, start + MIN_WORD_DUR);

  const next = sorted.map((w, idx) => (idx === i ? { ...w, start, end } : w));
  return resolveCollisions(next, i, push);
}

export function moveWord(words: LyricWord[], id: string, nextStart: number, push = false): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((w) => w.id === id);
  if (i < 0) return words;
  const cur = sorted[i];
  const dur = cur.end - cur.start;
  const next = sorted.map((w, idx) => (idx === i ? { ...w, start: nextStart, end: nextStart + dur } : w));
  return resolveCollisions(next, i, push);
}

function resolveCollisions(words: LyricWord[], index: number, push: boolean): LyricWord[] {
  const next = words.map((w) => ({ ...w }));
  const cur = next[index];
  if (!cur) return words;

  if (index > 0) {
    const prev = next[index - 1];
    if (cur.start < prev.end) {
      if (push) {
        prev.end = Math.max(prev.start + MIN_WORD_DUR, cur.start);
        if (cur.start < prev.end) cur.start = prev.end;
        if (cur.end < cur.start + MIN_WORD_DUR) cur.end = cur.start + MIN_WORD_DUR;
      } else {
        cur.start = prev.end;
        if (cur.end < cur.start + MIN_WORD_DUR) cur.end = cur.start + MIN_WORD_DUR;
      }
    }
  }

  if (index < next.length - 1) {
    const nxt = next[index + 1];
    if (cur.end > nxt.start) {
      if (push) {
        nxt.start = Math.min(nxt.end - MIN_WORD_DUR, cur.end);
        if (cur.end > nxt.start) cur.end = nxt.start;
        if (cur.end < cur.start + MIN_WORD_DUR) {
          cur.end = cur.start + MIN_WORD_DUR;
          nxt.start = Math.max(nxt.start, cur.end);
        }
      } else {
        cur.end = nxt.start;
        if (cur.end < cur.start + MIN_WORD_DUR) {
          cur.end = cur.start + MIN_WORD_DUR;
          cur.start = cur.end - MIN_WORD_DUR;
        }
      }
    }
  }

  return next;
}

export function removeWord(words: LyricWord[], id: string): LyricWord[] {
  return words.filter((w) => w.id !== id);
}

export function insertAfter(words: LyricWord[], id: string, text = "word"): { words: LyricWord[]; createdId: string } {
  const sorted = [...words].sort((a, b) => a.start - b.start).map((w) => ({ ...w }));
  const i = sorted.findIndex((w) => w.id === id);
  if (i < 0) {
    const next = insertWord(words, words.at(-1)?.end ?? 0, text);
    const added = next.find((w) => !words.some((o) => o.id === w.id));
    return { words: next, createdId: added?.id ?? id };
  }
  const cur = sorted[i]!;
  const nxt = sorted[i + 1];
  const min = MIN_WORD_DUR;
  const want = 0.28;
  let start = cur.end;
  let end = start + want;
  if (nxt && nxt.start < end) {
    const nxtRoom = Math.max(min, nxt.end - nxt.start);
    const take = Math.min(want, Math.max(min, nxtRoom * 0.45));
    const nxtStart = Math.min(nxt.end - min, cur.end + take);
    if (nxtStart - cur.end < min) {
      const curEnd = Math.max(cur.start + min, nxtStart - min);
      sorted[i] = { ...cur, end: curEnd };
      start = curEnd;
      end = curEnd + min;
    } else {
      start = cur.end;
      end = nxtStart;
    }
    sorted[i + 1] = { ...nxt, start: end };
    if (sorted[i + 1]!.end < end + min) sorted[i + 1] = { ...sorted[i + 1]!, end: end + min };
  }
  if (end - start < min) end = start + min;
  const createdId = nextWordId();
  sorted.splice(i + 1, 0, { id: createdId, text, start, end, line: cur.line });
  return { words: sorted, createdId };
}

export function insertWord(words: LyricWord[], atTime: number, text = "word"): LyricWord[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const over = sorted.find((w) => atTime >= w.start && atTime < w.end);
  let start = atTime;
  let end = atTime + 0.36;
  let line = 0;
  if (over) {
    start = over.end;
    end = start + 0.36;
    line = over.line;
    const after = sorted.find((w) => w.start >= over.end && w.id !== over.id);
    if (after) end = Math.min(end, Math.max(start + MIN_WORD_DUR, after.start));
  } else {
    const prev = [...sorted].reverse().find((w) => w.end <= atTime);
    const nxt = sorted.find((w) => w.start >= atTime);
    line = prev?.line ?? nxt?.line ?? 0;
    if (nxt) end = Math.min(end, nxt.start);
    if (end - start < MIN_WORD_DUR && nxt) {
      start = Math.max(prev?.end ?? atTime, nxt.start - 0.28);
      end = nxt.start;
    }
  }
  if (end - start < MIN_WORD_DUR) {
    end = start + MIN_WORD_DUR;
  }
  return [...sorted, { id: nextWordId(), text, start, end, line }].sort((a, b) => a.start - b.start);
}

export function setWordText(words: LyricWord[], id: string, text: string): LyricWord[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return removeWord(words, id);
  const parts = tokenizeLine(trimmed);
  if (parts.length <= 1) {
    return words.map((w) => (w.id === id ? { ...w, text: parts[0] ?? trimmed } : w));
  }
  const target = words.find((w) => w.id === id);
  if (!target) return words;
  const rest = words.filter((w) => w.id !== id);
  const span = Math.max(MIN_WORD_DUR * parts.length, target.end - target.start);
  const split = parts.map((token, i) => ({
    id: i === 0 ? target.id : nextWordId(),
    text: token,
    start: target.start + (i / parts.length) * span,
    end: target.start + ((i + 1) / parts.length) * span,
    line: target.line,
  }));
  return [...rest, ...split].sort((a, b) => a.start - b.start);
}

export function nudgeWord(words: LyricWord[], id: string, delta: number, edge: "both" | "start" | "end" = "both"): LyricWord[] {
  const w = words.find((x) => x.id === id);
  if (!w) return words;
  if (edge === "both") return moveWord(words, id, w.start + delta, true);
  if (edge === "start") return resizeWord(words, id, "start", w.start + delta, true);
  return resizeWord(words, id, "end", w.end + delta, true);
}
