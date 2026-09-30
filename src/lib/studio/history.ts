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
  PacingId,
  Recipe,
  Region,
  TranscribeSource,
} from "./types";

export type UndoSlice = {
  words: LyricWord[];
  lyrics: LyricLine[];
  lyricDraft: string;
  lyricsDirty: boolean;
  selectedWordId: string | null;
  region: Region;
  selectedClipIds: string[];
  userClips: MediaClip[];
  captionPrefs: CaptionPrefs;
  captionStyles: CaptionStyleId[];
  captionEffects: CaptionEffectId[];
  fonts: CaptionFontId[];
  looks: LookId[];
  framings: FramingId[];
  pacing: PacingId;
  batchSize: 12 | 24 | 36 | 48;
  recipes: Recipe[];
  selectedId: string | null;
  packId: string;
  transcribeSource: TranscribeSource;
  notice: string | null;
  lastTranscribedRegion: Region | null;
};

type Entry = { key: string; at: number; snap: UndoSlice };

const undo: Entry[] = [];
const redo: UndoSlice[] = [];
let gesture: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function onHistory(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sliceOf(s: UndoSlice): UndoSlice {
  return {
    words: s.words,
    lyrics: s.lyrics,
    lyricDraft: s.lyricDraft,
    lyricsDirty: s.lyricsDirty,
    selectedWordId: s.selectedWordId,
    region: s.region,
    selectedClipIds: s.selectedClipIds,
    userClips: s.userClips,
    captionPrefs: s.captionPrefs,
    captionStyles: s.captionStyles,
    captionEffects: s.captionEffects,
    fonts: s.fonts,
    looks: s.looks,
    framings: s.framings,
    pacing: s.pacing,
    batchSize: s.batchSize,
    recipes: s.recipes,
    selectedId: s.selectedId,
    packId: s.packId,
    transcribeSource: s.transcribeSource,
    notice: s.notice,
    lastTranscribedRegion: s.lastTranscribedRegion,
  };
}

export function historyFlags() {
  return { canUndo: undo.length > 0, canRedo: redo.length > 0 };
}

export function remember(key: string, snap: UndoSlice) {
  if (gesture === key) return;
  const now = Date.now();
  const top = undo[undo.length - 1];
  if (top && top.key === key && now - top.at < 500) {
    top.at = now;
    redo.length = 0;
    return;
  }
  undo.push({ key, at: now, snap });
  if (undo.length > 80) undo.shift();
  redo.length = 0;
  emit();
}

export function beginGesture(key: string, snap: UndoSlice) {
  if (gesture) return;
  gesture = key;
  undo.push({ key, at: Date.now(), snap });
  if (undo.length > 80) undo.shift();
  redo.length = 0;
  emit();
}

export function endGesture() {
  gesture = null;
}

export function popUndo(current: UndoSlice): UndoSlice | null {
  const prev = undo.pop();
  if (!prev) return null;
  redo.push(current);
  if (redo.length > 80) redo.shift();
  gesture = null;
  emit();
  return prev.snap;
}

export function popRedo(current: UndoSlice): UndoSlice | null {
  const next = redo.pop();
  if (!next) return null;
  undo.push({ key: "redo", at: Date.now(), snap: current });
  emit();
  return next;
}

export function clearHistory() {
  undo.length = 0;
  redo.length = 0;
  gesture = null;
  emit();
}
