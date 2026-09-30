export type HeardWord = { text: string; startMs: number; endMs: number };

export type AlignedWord = {
  text: string;
  line: number;
  startMs: number;
  endMs: number;
  lowConfidence: boolean;
};

export type AlignResult = {
  words: AlignedWord[];
  draft: string;
  warning: string | null;
};

type PasteToken = { text: string; norm: string; line: number; lineText: string };

const GAP = 1.15;

export function alignPastedLyrics(paste: string, heard: HeardWord[], windowEndMs: number, windowStartMs = 0): AlignResult {
  const tokens = tokenizePaste(paste);
  const heardClean = heard
    .map((word) => ({ ...word, norm: normalize(word.text) }))
    .filter((word) => word.norm && word.endMs > word.startMs);
  if (!tokens.length) {
    return { words: [], draft: "", warning: "Paste the lyrics for this section first." };
  }
  if (!heardClean.length) {
    return {
      words: [],
      draft: "",
      warning: "No vocal words were heard in this snippet. Try another window, or transcribe instead.",
    };
  }

  const pairs = localAlign(
    tokens.map((token) => token.norm),
    heardClean.map((word) => word.norm),
  );
  const exact = pairs.filter((pair) => pair.exact).length;
  if (!pairs.length || exact < 1) {
    return {
      words: [],
      draft: "",
      warning: "Couldn’t find these lyrics in the snippet. Paste the lines from this section, or transcribe instead.",
    };
  }

  const firstLine = tokens[pairs[0]!.paste]!.line;
  const lastLine = tokens[pairs[pairs.length - 1]!.paste]!.line;
  const kept = tokens.filter((token) => token.line >= firstLine && token.line <= lastLine);
  const pairByPaste = new Map(pairs.map((pair) => [pair.paste, pair]));
  const matchedDurations = pairs
    .map((pair) => heardClean[pair.heard]!.endMs - heardClean[pair.heard]!.startMs)
    .filter((dur) => dur >= 40 && dur <= 1600);
  const typical = median(matchedDurations) || 280;

  const placed: AlignedWord[] = [];
  const lineOrder: number[] = [];
  for (const token of kept) {
    if (!lineOrder.includes(token.line)) lineOrder.push(token.line);
  }
  const lineIndex = new Map(lineOrder.map((line, index) => [line, index]));

  for (let k = 0; k < kept.length; k++) {
    const token = kept[k]!;
    const source = tokens.indexOf(token);
    const hit = pairByPaste.get(source);
    if (hit) {
      const heardWord = heardClean[hit.heard]!;
      placed.push({
        text: token.text,
        line: lineIndex.get(token.line) ?? 0,
        startMs: heardWord.startMs,
        endMs: Math.max(heardWord.startMs + 40, heardWord.endMs),
        lowConfidence: !hit.exact,
      });
      continue;
    }
    const prev = previousHit(kept, k, tokens, pairByPaste, heardClean);
    const next = nextHit(kept, k, tokens, pairByPaste, heardClean);
    const slot = gapSlot(kept, k, tokens, pairByPaste);
    const timed = timeInGap(slot, prev, next, typical, windowStartMs, windowEndMs);
    placed.push({
      text: token.text,
      line: lineIndex.get(token.line) ?? 0,
      startMs: timed.startMs,
      endMs: timed.endMs,
      lowConfidence: true,
    });
  }

  const ordered = placed.sort((a, b) => a.line - b.line || a.startMs - b.startMs);
  const draft = lineOrder.map((line) => kept.find((token) => token.line === line)?.lineText ?? "").join("\n");
  const shaky = ordered.filter((word) => word.lowConfidence).length;
  return {
    words: ordered,
    draft,
    warning: shaky
      ? `${shaky} word${shaky === 1 ? "" : "s"} didn’t lock cleanly. They’re outlined in red — the rest use the vocal’s own timing.`
      : null,
  };
}

function tokenizePaste(paste: string): PasteToken[] {
  const lines = paste.replace(/\r\n/g, "\n").split("\n");
  const tokens: PasteToken[] = [];
  let lineNo = 0;
  for (const raw of lines) {
    const lineText = raw.trim();
    if (!lineText) continue;
    const parts = lineText.split(/\s+/).filter(Boolean);
    for (const text of parts) {
      const norm = normalize(text);
      if (!norm) continue;
      tokens.push({ text, norm, line: lineNo, lineText });
    }
    lineNo += 1;
  }
  return tokens;
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/'/g, "");
}

type Pair = { paste: number; heard: number; exact: boolean };

function localAlign(paste: string[], heard: string[]): Pair[] {
  const n = paste.length;
  const m = heard.length;
  const score: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const back: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const weight = matchScore(paste[i - 1]!, heard[j - 1]!);
      const diag = score[i - 1]![j - 1]! + weight;
      const up = score[i - 1]![j]! - GAP;
      const left = score[i]![j - 1]! - GAP;
      let next = 0;
      let from = 0;
      if (diag >= up && diag >= left && diag > 0) {
        next = diag;
        from = 1;
      } else if (up >= left && up > 0) {
        next = up;
        from = 2;
      } else if (left > 0) {
        next = left;
        from = 3;
      }
      score[i]![j] = next;
      back[i]![j] = from;
      if (next > best) {
        best = next;
        bi = i;
        bj = j;
      }
    }
  }
  const pairs: Pair[] = [];
  let i = bi;
  let j = bj;
  while (i > 0 && j > 0 && back[i]![j] !== 0) {
    const from = back[i]![j]!;
    if (from === 1) {
      const a = paste[i - 1]!;
      const b = heard[j - 1]!;
      pairs.push({ paste: i - 1, heard: j - 1, exact: a === b });
      i -= 1;
      j -= 1;
    } else if (from === 2) i -= 1;
    else j -= 1;
  }
  pairs.reverse();
  return pairs;
}

function matchScore(a: string, b: string) {
  if (!a || !b) return -1.4;
  if (a === b) return 4;
  if (close(a, b)) return 2.2;
  return -1.5;
}

function close(a: string, b: string) {
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  const dist = levenshtein(a, b);
  return dist / Math.max(a.length, b.length) <= 0.34;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const row = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

function previousHit(
  kept: PasteToken[],
  index: number,
  tokens: PasteToken[],
  pairs: Map<number, Pair>,
  heard: HeardWord[],
) {
  for (let i = index - 1; i >= 0; i--) {
    const hit = pairs.get(tokens.indexOf(kept[i]!));
    if (hit) return heard[hit.heard]!;
  }
  return null;
}

function nextHit(
  kept: PasteToken[],
  index: number,
  tokens: PasteToken[],
  pairs: Map<number, Pair>,
  heard: HeardWord[],
) {
  for (let i = index + 1; i < kept.length; i++) {
    const hit = pairs.get(tokens.indexOf(kept[i]!));
    if (hit) return heard[hit.heard]!;
  }
  return null;
}

function gapSlot(kept: PasteToken[], index: number, tokens: PasteToken[], pairs: Map<number, Pair>) {
  let start = index;
  while (start > 0 && !pairs.has(tokens.indexOf(kept[start - 1]!))) start -= 1;
  let end = index;
  while (end < kept.length - 1 && !pairs.has(tokens.indexOf(kept[end + 1]!))) end += 1;
  const run = kept.slice(start, end + 1);
  const at = index - start;
  const weights = run.map((token) => Math.max(1, token.norm.length));
  const total = weights.reduce((sum, n) => sum + n, 0);
  const before = weights.slice(0, at).reduce((sum, n) => sum + n, 0);
  return { before, weight: weights[at] ?? 1, total };
}

function timeInGap(
  slot: { before: number; weight: number; total: number },
  prev: HeardWord | null,
  next: HeardWord | null,
  typical: number,
  windowStartMs: number,
  windowEndMs: number,
) {
  const share = slot.weight / slot.total;
  const lead = slot.before / slot.total;
  let start = windowStartMs;
  let end = windowStartMs + typical;
  if (prev && next) {
    const gapStart = prev.endMs;
    const gapEnd = Math.max(gapStart + 1, next.startMs);
    const span = Math.max(1, gapEnd - gapStart);
    start = gapStart + lead * span;
    end = Math.min(gapEnd, start + Math.max(1, share * span));
  } else if (prev) {
    const msPer = Math.max(35, typical / 4);
    const span = msPer * slot.total;
    start = prev.endMs + lead * span;
    end = start + Math.max(40, share * span);
  } else if (next) {
    const msPer = Math.max(35, typical / 4);
    const span = msPer * slot.total;
    start = next.startMs - span + lead * span;
    end = start + Math.max(40, share * span);
  }
  start = Math.round(Math.max(windowStartMs, Math.min(windowEndMs - 40, start)));
  end = Math.round(Math.max(start + 40, Math.min(windowEndMs, end)));
  if (next && end > next.startMs) end = Math.max(start + 1, next.startMs);
  if (prev && start < prev.endMs) start = Math.min(end - 1, prev.endMs);
  if (end <= start) end = start + 40;
  return { startMs: start, endMs: end };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
