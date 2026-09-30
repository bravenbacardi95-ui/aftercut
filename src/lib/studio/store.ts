import { create } from "zustand";
import { analyzeAudio } from "./beats";
import { setHearing } from "./yield";
import { DEFAULT_CUT_IDS, DEMO_LYRICS, PACKS, resolveCutClips } from "./packs";
import { downloadZip, exportRecipeBatch, type BatchExportRow } from "./export-batch";
import {
  applyDraft,
  insertAfter,
  insertWord,
  moveWord,
  nudgeWord,
  removeWord,
  resizeWord,
  setWordText,
  snapTime,
  wordsToDraft,
  nextWordId,
} from "./lyrics";
import { buildRecipes, buildSingleRecipe, followRegion, moveCutTime, moveSegmentTo, removeCutAt, splitCuts } from "./recipes";
import { findSavedLyrics, loadLyricBank, lyricKey, persistLyricBank, type LyricVersion } from "./lyric-bank";
import { commitWords, transcribeRegion } from "./transcribe";
import { alignLyrics } from "./align.fn";
import { prepareVocalStem } from "./vocal-stem";
import { clearHints } from "./lyric-hints";
import { setDecodedAudio, blobToBase64 } from "./audio-clip";
import { clearVocalStemCache } from "./vocal-stem";
import { beginGesture, clearHistory, endGesture, historyFlags, onHistory, popRedo, popUndo, remember, sliceOf } from "./history";
import { searchVaultCatalog } from "./vault-catalog";
import { searchStockVault } from "./stock-search.fn";
import { DEFAULT_CAPTION_PREFS, MAX_REGION, MIN_REGION } from "./types";
import type {
  AudioAnalysis,
  CaptionCaseId,
  CaptionEffectId,
  CaptionFontId,
  CaptionPosId,
  CaptionPrefs,
  CaptionSizeId,
  CaptionStyleId,
  FramingId,
  LookId,
  LyricLine,
  LyricWord,
  MediaClip,
  PacingId,
  Recipe,
  Region,
  StudioStep,
  TranscribeSource,
} from "./types";

type StudioState = {
  step: StudioStep;
  trackName: string;
  audioUrl: string | null;
  analysis: AudioAnalysis | null;
  region: Region;
  lyricDraft: string;
  words: LyricWord[];
  lyrics: LyricLine[];
  transcribeSource: TranscribeSource;
  transcribeStatus: string;
  transcribing: boolean;
  lyricsDirty: boolean;
  lastTranscribedRegion: Region | null;
  isDemo: boolean;
  snapEnabled: boolean;
  selectedWordId: string | null;
  error: string | null;
  notice: string | null;
  noticeError: boolean;
  transcribeGen: number;
  captionPrefs: CaptionPrefs;
  packId: string;
  footageTab: "stock" | "upload";
  selectedClipIds: string[];
  userClips: MediaClip[];
  vaultClips: MediaClip[];
  vaultQuery: string;
  vaultBusy: boolean;
  vaultError: string | null;
  captionStyles: CaptionStyleId[];
  captionEffects: CaptionEffectId[];
  fonts: CaptionFontId[];
  looks: LookId[];
  framings: FramingId[];
  pacing: PacingId;
  batchSize: 12 | 24 | 36 | 48;
  mode: "single" | "batch";
  recipes: Recipe[];
  selectedId: string | null;
  generating: boolean;
  exporting: boolean;
  batchRows: BatchExportRow[];
  batchNote: string | null;
  exportBatch: () => Promise<void>;
  cancelBatchExport: () => void;
  setStep: (step: StudioStep) => void;
  loadFile: (file: File, isDemo?: boolean) => Promise<void>;
  loadDemo: () => Promise<void>;
  setRegion: (region: Region, opts?: { preview?: boolean }) => void;
  setLyricDraft: (text: string) => void;
  applyLyrics: () => void;
  transcribe: () => Promise<void>;
  isolateVocals: boolean;
  setIsolateVocals: (on: boolean) => void;
  onsetSnap: boolean;
  setOnsetSnap: (on: boolean) => void;
  syncOffsetMs: number;
  setSyncOffset: (ms: number) => void;
  nudgeLine: (line: number, deltaMs: number) => void;
  syncLyrics: () => Promise<void>;
  syncProgress: number | null;
  selectWord: (id: string | null) => void;
  updateWordText: (id: string, text: string) => void;
  resizeWordEdge: (id: string, edge: "start" | "end", time: number) => void;
  moveWordTo: (id: string, start: number) => void;
  deleteWord: (id: string) => void;
  addWordAt: (time: number, text?: string) => void;
  insertAfterWord: (id: string, text?: string) => void;
  nudgeSelected: (delta: number, edge?: "both" | "start" | "end") => void;
  setSnapEnabled: (on: boolean) => void;
  setCaptionPrefs: (patch: Partial<CaptionPrefs>) => void;
  setCategory: (id: string) => void;
  setFootageTab: (tab: "stock" | "upload") => void;
  toggleCutClip: (id: string) => void;
  addUserClip: (clip: MediaClip) => void;
  setUserClipPoster: (id: string, poster: string) => void;
  searchVault: (query: string) => Promise<void>;
  removeUserClip: (id: string) => void;
  removeFromCut: (id: string) => void;
  clearStock: () => void;
  addCategoryToCut: (categoryId: string) => void;
  toggleStyle: (id: CaptionStyleId) => void;
  toggleEffect: (id: CaptionEffectId) => void;
  toggleFont: (id: CaptionFontId) => void;
  toggleLook: (id: LookId) => void;
  toggleFraming: (id: FramingId) => void;
  setPacing: (p: PacingId) => void;
  setBatchSize: (n: 12 | 24 | 36 | 48) => void;
  setMode: (mode: "single" | "batch") => void;
  makeSingle: () => void;
  generate: () => void;
  selectRecipe: (id: string | null) => void;
  updateSelected: (patch: Partial<Pick<Recipe, "captionStyle" | "font" | "effect" | "look" | "framing">>) => void;
  saveLyricVersion: (name: string) => void;
  loadLyricVersion: (id: string) => void;
  deleteLyricVersion: (id: string) => void;
  lyricBank: LyricVersion[];
  activeLyricId: string | null;
  setSegmentClip: (segment: number, clipId: string) => void;
  moveRecipeCut: (index: number, time: number) => void;
  moveRecipeSegment: (from: number, dropTime: number) => void;
  splitRecipeAt: (time: number) => void;
  removeRecipeCut: (index: number) => void;
  clips: () => MediaClip[];
  selected: () => Recipe | null;
  reset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  beginEdit: (key: string) => void;
  endEdit: () => void;
};

const defaults = {
  step: "track" as StudioStep,
  trackName: "",
  audioUrl: null as string | null,
  analysis: null as AudioAnalysis | null,
  region: { start: 0, end: 15 },
  lyricDraft: "",
  words: [] as LyricWord[],
  lyrics: [] as LyricLine[],
  transcribeSource: null as TranscribeSource,
  transcribeStatus: "",
  transcribing: false,
  syncProgress: null as number | null,
  lyricsDirty: false,
  lastTranscribedRegion: null as Region | null,
  isDemo: false,
  isolateVocals: true,
  onsetSnap: false,
  syncOffsetMs: 0,
  snapEnabled: true,
  selectedWordId: null as string | null,
  error: null as string | null,
  notice: null as string | null,
  noticeError: false,
  transcribeGen: 0,
  captionPrefs: { ...DEFAULT_CAPTION_PREFS },
  packId: PACKS[0]?.id ?? "night",
  footageTab: "stock" as const,
  selectedClipIds: [...DEFAULT_CUT_IDS],
  userClips: [] as MediaClip[],
  vaultClips: [] as MediaClip[],
  vaultQuery: "",
  vaultBusy: false,
  vaultError: null as string | null,
  captionStyles: ["line"] as CaptionStyleId[],
  captionEffects: ["none"] as CaptionEffectId[],
  fonts: ["brat"] as CaptionFontId[],
  looks: ["film"] as LookId[],
  framings: ["fill"] as FramingId[],
  pacing: "smart" as PacingId,
  batchSize: 24 as 12 | 24 | 36 | 48,
  mode: "single" as const,
  recipes: [] as Recipe[],
  selectedId: null as string | null,
  generating: false,
  exporting: false,
  batchRows: [] as BatchExportRow[],
  batchNote: null as string | null,
  lyricBank: loadLyricBank(),
  activeLyricId: null as string | null,
  canUndo: false,
  canRedo: false,
};

function clampRegion(region: Region, duration: number): Region {
  const span = Math.min(MAX_REGION, Math.max(MIN_REGION, region.end - region.start));
  let start = Math.max(0, Math.min(region.start, Math.max(0, duration - span)));
  let end = Math.min(duration, start + span);
  if (end - start < MIN_REGION) {
    end = Math.min(duration, start + MIN_REGION);
    start = Math.max(0, end - MIN_REGION);
  }
  return { start, end };
}

function snapPoints(analysis: AudioAnalysis | null): number[] {
  if (!analysis) return [];
  return [...analysis.beats, ...analysis.onsets];
}

function regionClose(a: Region | null, b: Region, eps = 0.08) {
  if (!a) return false;
  return Math.abs(a.start - b.start) < eps && Math.abs(a.end - b.end) < eps;
}

function focusChoice<T>(cur: T[], id: T): T[] {
  if (!cur.includes(id)) return [id, ...cur];
  if (cur[0] === id) return cur.length === 1 ? cur : cur.slice(1);
  return [id, ...cur.filter((item) => item !== id)];
}

function fallbackClipIds(recipe: Recipe, clips: MediaClip[]): string[] {
  const ids = clips.map((c) => c.id);
  const segments = Math.max(1, (recipe.cuts?.length ?? 2) - 1);
  if (!ids.length) return [];
  return Array.from({ length: segments }, (_, i) => {
    const order = recipe.clipOrder?.[i % Math.max(1, recipe.clipOrder.length)] ?? i;
    return ids[order % ids.length]!;
  });
}

function patchOpenRecipe(
  get: () => StudioState,
  set: (partial: Partial<StudioState>) => void,
  mut: (recipe: Recipe) => Recipe,
) {
  const { recipes, selectedId } = get();
  const id = selectedId ?? recipes[0]?.id;
  if (!id) return;
  remember("footage", sliceOf(get()));
  set({
    selectedId: id,
    recipes: recipes.map((recipe) => (recipe.id === id ? mut({ ...recipe, clipIds: recipe.clipIds ?? [] }) : recipe)),
  });
}

function touchSavedLyrics(get: () => StudioState, set: (partial: Partial<StudioState>) => void) {
  const { activeLyricId, lyricBank, words, lyricDraft, region, trackName, analysis } = get();
  if (!activeLyricId || !words.length) return;
  const duration = analysis?.duration;
  const next = lyricBank.map((version) =>
    version.id === activeLyricId
      ? {
          ...version,
          words: words.map((word) => ({ ...word })),
          lyricDraft,
          region: { ...region },
          trackName: trackName || version.trackName,
          duration: duration ?? version.duration,
          key: lyricKey(trackName || version.trackName, duration ?? version.duration ?? 0),
          savedAt: Date.now(),
        }
      : version,
  );
  persistLyricBank(next);
  set({ lyricBank: next });
}

let touchTimer: ReturnType<typeof setTimeout> | null = null;
function queueTouch(get: () => StudioState, set: (partial: Partial<StudioState>) => void) {
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    touchTimer = null;
    touchSavedLyrics(get, set);
  }, 180);
}
function flushTouch(get: () => StudioState, set: (partial: Partial<StudioState>) => void) {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }
  touchSavedLyrics(get, set);
}

function isDemoLyricDump(version: { lyricDraft?: string; words: { text: string }[] }) {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const demo = norm(DEMO_LYRICS);
  const draft = norm(version.lyricDraft ?? "");
  const sung = norm(version.words.map((word) => word.text).join(" "));
  return draft === demo || sung === demo;
}

function syncSingleCut(get: () => StudioState, set: (partial: Partial<StudioState>) => void) {
  if (get().mode !== "single") return;
  const { analysis, region, captionStyles, captionEffects, fonts, looks, framings } = get();
  if (!analysis) return;
  const clips = get().clips();
  const batch = get().recipes.filter((recipe) => recipe.id !== "single");
  if (!clips.length) {
    set({ recipes: batch, selectedId: batch[0]?.id ?? null });
    return;
  }
  const ids = clips.map((clip) => clip.id).join("|");
  const existing = get().recipes.find((recipe) => recipe.id === "single");
  if (existing?.clipIds?.join("|") === ids) return;
  const recipe = buildSingleRecipe({
    clipIds: clips.map((clip) => clip.id),
    region,
    analysis,
    style: existing?.captionStyle ?? captionStyles[0] ?? "word",
    font: existing?.font ?? fonts[0] ?? "brat",
    effect: existing?.effect ?? captionEffects[0] ?? "none",
    look: existing?.look ?? looks[0] ?? "film",
    framing: existing?.framing ?? framings[0] ?? "fill",
  });
  set({ recipes: [recipe, ...batch], selectedId: recipe.id, step: "edit" });
}

let dragRegionFrom: Region | null = null;
let batchAbort: AbortController | null = null;

function slugTrack(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "aftercut";
}

export const useStudio = create<StudioState>((set, get) => ({
  ...defaults,
  setStep: (step) => set({ step }),
  loadFile: async (file, isDemo = false) => {
    clearHistory();
    clearHints();
    clearVocalStemCache();
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    const gen = get().transcribeGen + 1;
    const trackName = file.name.replace(/\.[^.]+$/, "");
    set({
      error: null,
      notice: null,
      noticeError: false,
      trackName,
      transcribeGen: gen,
      lyricsDirty: false,
      selectedWordId: null,
      transcribeSource: null,
      lyricDraft: "",
      words: [],
      lyrics: [],
      isDemo,
      lastTranscribedRegion: null,
      transcribeStatus: "Reading the track…",
      recipes: [],
      selectedId: null,
      activeLyricId: null,
    });
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    try {
      const url = URL.createObjectURL(file);
      set({ audioUrl: url, transcribeStatus: "Reading the track…" });
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      const buf = await file.arrayBuffer();
      const analysis = await analyzeAudio(buf, url);
      const end = Math.min(15, analysis.duration);
      const region = clampRegion({ start: 0, end: Math.max(6, end) }, analysis.duration);
      const saved = isDemo
        ? (findSavedLyrics(get().lyricBank, trackName, analysis.duration) ??
          findSavedLyrics(get().lyricBank, "demo track", analysis.duration))
        : findSavedLyrics(get().lyricBank, trackName, analysis.duration);
      if (saved?.words.length && (isDemo || !isDemoLyricDump(saved))) {
        const restored = clampRegion(saved.region, analysis.duration);
        set({
          audioUrl: url,
          analysis,
          region: restored,
          ...commitWords(saved.words.map((word) => ({ ...word }))),
          step: "setup",
          transcribing: false,
          transcribeStatus: "",
          transcribeSource: "manual",
          lastTranscribedRegion: restored,
          lyricsDirty: false,
          activeLyricId: saved.id,
          notice: `Restored “${saved.name}” for this song.`,
          noticeError: false,
        });
        return;
      }
      set({
        audioUrl: url,
        analysis,
        region,
        lyricDraft: "",
        words: [],
        lyrics: [],
        step: "setup",
        transcribing: false,
        transcribeStatus: "",
        notice: "Snippet starts at the top of the song. Paste the lyrics, then press Sync lyrics.",
        noticeError: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Could not read that audio file.",
        transcribing: false,
        transcribeStatus: "",
      });
    }
  },
  loadDemo: async () => {
    set({ error: null });
    const res = await fetch("/demo/demo-track.wav");
    if (!res.ok) {
      set({ error: "Demo track failed to load." });
      return;
    }
    const blob = await res.blob();
    const file = new File([blob], "demo-track.wav", { type: "audio/wav" });
    await get().loadFile(file, true);
    const saved = findSavedLyrics(get().lyricBank, "demo track", get().analysis?.duration ?? 0);
    set({ trackName: saved?.trackName || "demo track" });
  },
  setRegion: (next, opts) => {
    const analysis = get().analysis;
    const region = analysis ? clampRegion(next, analysis.duration) : next;
    if (opts?.preview) {
      if (!dragRegionFrom) dragRegionFrom = get().region;
      set({ region });
      return;
    }
    const from = dragRegionFrom ?? get().region;
    dragRegionFrom = null;
    remember("region", sliceOf(get()));
    const moved = !regionClose(get().lastTranscribedRegion, region);
    const movedNotice = moved && get().lastTranscribedRegion && get().words.length;
    const same =
      Math.abs(from.start - region.start) < 0.001 && Math.abs(from.end - region.end) < 0.001;
    const recipes =
      analysis && !same ? get().recipes.map((recipe) => followRegion(recipe, from, region, analysis)) : get().recipes;
    set({
      region,
      recipes,
      notice: movedNotice
        ? "Snippet moved. Your edits stayed put — press Re-sync to new window if this section should be timed again."
        : get().notice,
      noticeError: movedNotice ? false : get().noticeError,
    });
  },
  setLyricDraft: (lyricDraft) => {
    const committed = wordsToDraft(get().words);
    remember("draft", sliceOf(get()));
    set({ lyricDraft, lyricsDirty: lyricDraft.trim() !== committed.trim() });
  },
  applyLyrics: () => {
    const { lyricDraft, words, region, transcribing } = get();
    if (transcribing) return;
    const committed = wordsToDraft(words);
    if (lyricDraft.trim() === committed.trim()) return;
    remember("lyrics", sliceOf(get()));
    set({
      ...commitWords(applyDraft(words, lyricDraft, region)),
      lyricsDirty: true,
      transcribeSource: "manual",
      notice: null,
      noticeError: false,
    });
    touchSavedLyrics(get, set);
  },
  setIsolateVocals: (isolateVocals) => set({ isolateVocals }),
  setOnsetSnap: (onsetSnap) => set({ onsetSnap }),
  setSyncOffset: (ms) => {
    const next = Math.max(-200, Math.min(200, Math.round(ms)));
    const delta = (next - get().syncOffsetMs) / 1000;
    if (!delta) return;
    remember("sync-offset", sliceOf(get()));
    const words = get().words.map((word) => ({
      ...word,
      start: Math.max(0, word.start + delta),
      end: Math.max(0.04, word.end + delta),
    }));
    set({ syncOffsetMs: next, ...commitWords(words, "authored") });
  },
  nudgeLine: (line, deltaMs) => {
    const delta = deltaMs / 1000;
    if (!delta) return;
    remember("line-nudge", sliceOf(get()));
    const words = get().words.map((word) =>
      word.line === line
        ? { ...word, start: Math.max(0, word.start + delta), end: Math.max(0.04, word.end + delta) }
        : word,
    );
    set({ ...commitWords(words, "authored") });
  },
  syncLyrics: async () => {
    const text = get().lyricDraft.trim();
    if (!text) {
      set({ notice: "Paste the lyrics for this section first.", noticeError: false });
      return;
    }
    if (!get().analysis) return;
    const gen = get().transcribeGen + 1;
    const region = get().region;
    set({
      transcribeGen: gen,
      transcribing: true,
      lyricsDirty: false,
      notice: null,
      noticeError: false,
      syncProgress: 0,
      transcribeStatus: get().isolateVocals ? "Isolating vocals…" : "Reading the full mix…",
    });
    setHearing(true);
    try {
      const stem = await prepareVocalStem({
        audioUrl: get().audioUrl,
        region,
        isolate: get().isolateVocals,
        onStatus: (label) => {
          if (get().transcribeGen !== gen) return;
          set({ transcribeStatus: label, syncProgress: null });
        },
      });
      if (get().transcribeGen !== gen) return;
      if (!stem) throw new Error("The track isn’t ready yet. Drop it again.");
      if (get().isolateVocals && !stem.isolated) {
        set({
          transcribing: false,
          transcribeStatus: "",
          syncProgress: null,
          notice: stem.error ?? "Vocal isolation failed. Sync did not use the full mix.",
          noticeError: true,
        });
        return;
      }
      set({ transcribeStatus: "Aligning the vocal…", syncProgress: null });
      const aligned = await alignLyrics({
        data: {
          wavBase64: await blobToBase64(stem.blob),
          text,
          isolated: stem.isolated,
          snap: get().onsetSnap,
        },
      });
      if (get().transcribeGen !== gen) return;
      const offsetMs = Math.round(stem.offset * 1000);
      console.info("[sync] forced-align feed", aligned.ok ? aligned.feed : aligned.error, {
        stemOffsetMs: offsetMs,
        paddingMs: Math.max(0, Math.round((region.start - stem.offset) * 1000)),
        snippetStartMs: Math.round(region.start * 1000),
      });
      if (aligned.ok) {
        console.info("[sync] first words", aligned.words.slice(0, 10).map((word) => ({
          text: word.text,
          rawStartMs: Math.round(word.rawStartMs + offsetMs),
          startMs: Math.round(word.startMs + offsetMs),
          endMs: Math.round(word.endMs + offsetMs),
          confidence: word.confidence,
        })));
      }
      if (!aligned.ok || !aligned.words.length) {
        set({
          transcribing: false,
          transcribeStatus: "",
          syncProgress: null,
          notice: [stem.error, aligned.ok ? aligned.warning : aligned.error].filter(Boolean).join(" ") || "Couldn’t align these lyrics.",
          noticeError: true,
        });
        return;
      }
      const shift = get().syncOffsetMs / 1000;
      const words = aligned.words.map((word) => ({
        id: nextWordId(),
        text: word.text,
        start: (word.startMs + offsetMs) / 1000 + shift,
        end: Math.max((word.startMs + offsetMs) / 1000 + 0.04, (word.endMs + offsetMs) / 1000) + shift,
        line: word.line,
        confidence: word.confidence,
        lowConfidence: word.confidence < 0.5,
      }));
      remember("sync", sliceOf(get()));
      const isolationNote = stem.error
        ? stem.error
        : stem.isolated
          ? null
          : "Vocal isolation is off, so this pass used the full mix.";
      set({
        ...commitWords(words, "authored"),
        lyricDraft: text,
        transcribing: false,
        transcribeStatus: "",
        syncProgress: null,
        transcribeSource: "aligned",
        lastTranscribedRegion: { ...get().region },
        lyricsDirty: false,
        selectedWordId: null,
        notice: [isolationNote, aligned.warning].filter(Boolean).join(" ") || null,
        noticeError: false,
      });
    } catch (err) {
      if (get().transcribeGen !== gen) return;
      set({
        transcribing: false,
        transcribeStatus: "",
        syncProgress: null,
        notice: err instanceof Error ? err.message : "Sync failed",
        noticeError: true,
      });
    } finally {
      setHearing(false);
    }
  },
  transcribe: async () => {
    const gen = get().transcribeGen + 1;
    set({ transcribeGen: gen, transcribing: true, notice: null, noticeError: false, lyricsDirty: false, transcribeStatus: get().isolateVocals ? "Isolating vocals…" : "Hearing lyrics…" });
    await runTranscribe(gen);
  },
  selectWord: (selectedWordId) => set({ selectedWordId }),
  updateWordText: (id, text) => {
    remember(`text:${id}`, sliceOf(get()));
    set({ ...commitWords(setWordText(get().words, id, text)), lyricsDirty: true, selectedWordId: id });
    touchSavedLyrics(get, set);
  },
  resizeWordEdge: (id, edge, time) => {
    const t = get().snapEnabled ? snapTime(time, snapPoints(get().analysis)) : time;
    set({ ...commitWords(resizeWord(get().words, id, edge, t, true)), lyricsDirty: true, selectedWordId: id });
    queueTouch(get, set);
  },
  moveWordTo: (id, t) => {
    const time = get().snapEnabled ? snapTime(t, snapPoints(get().analysis)) : t;
    set({ ...commitWords(moveWord(get().words, id, time, false)), lyricsDirty: true, selectedWordId: id });
    queueTouch(get, set);
  },
  deleteWord: (id) => {
    const next = removeWord(get().words, id);
    remember("delete", sliceOf(get()));
    set({ ...commitWords(next), lyricsDirty: true, selectedWordId: null });
    touchSavedLyrics(get, set);
  },
  addWordAt: (time, text) => {
    const next = insertWord(get().words, time, text);
    const added = next.find((w) => !get().words.some((o) => o.id === w.id));
    remember("add", sliceOf(get()));
    set({ ...commitWords(next), lyricsDirty: true, selectedWordId: added?.id ?? get().selectedWordId });
    touchSavedLyrics(get, set);
  },
  insertAfterWord: (id, text) => {
    const { words, createdId } = insertAfter(get().words, id, text);
    remember("insert", sliceOf(get()));
    set({ ...commitWords(words), lyricsDirty: true, selectedWordId: createdId });
    touchSavedLyrics(get, set);
  },
  nudgeSelected: (delta, edge = "both") => {
    const id = get().selectedWordId;
    if (!id) return;
    remember("nudge", sliceOf(get()));
    set({ ...commitWords(nudgeWord(get().words, id, delta, edge)), lyricsDirty: true });
    touchSavedLyrics(get, set);
  },
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setCaptionPrefs: (patch) => {
    remember("caption", sliceOf(get()));
    set({ captionPrefs: { ...get().captionPrefs, ...patch } });
  },
  setCategory: (packId) => set({ packId }),
  setFootageTab: (footageTab) => set({ footageTab }),
  toggleCutClip: (id) => {
    const cur = get().selectedClipIds;
    const next = cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id];
    remember("cut", sliceOf(get()));
    set({ selectedClipIds: next });
    syncSingleCut(get, set);
  },
  addUserClip: (clip) => {
    remember("upload", sliceOf(get()));
    set({
      userClips: [clip, ...get().userClips.filter((item) => item.id !== clip.id)],
      selectedClipIds: get().selectedClipIds.includes(clip.id) ? get().selectedClipIds : [...get().selectedClipIds, clip.id],
    });
    syncSingleCut(get, set);
  },
  setUserClipPoster: (id, poster) => {
    set({
      userClips: get().userClips.map((clip) => (clip.id === id ? { ...clip, poster } : clip)),
    });
  },
  searchVault: async (query) => {
    const q = query.trim();
    if (q.length < 2) {
      set({ vaultQuery: q, vaultClips: [], vaultBusy: false, vaultError: null });
      return;
    }
    set({ vaultQuery: q, vaultBusy: true, vaultError: null });
    const local = () =>
      searchVaultCatalog(q).map((clip) => ({ ...clip, categoryId: `search:${q.toLowerCase()}` }));
    try {
      const result = await searchStockVault({ data: { query: q } });
      if (!result.ok) {
        const hits = local();
        set({
          vaultBusy: false,
          vaultClips: hits,
          vaultError: hits.length ? `${result.error} Showing stock that matched instead.` : result.error,
        });
        return;
      }
      const shots: MediaClip[] = result.shots.map((shot) => ({
        id: shot.id,
        kind: "image",
        src: shot.src,
        poster: shot.src,
        name: shot.name,
        origin: "stock",
        categoryId: `search:${q.toLowerCase()}`,
      }));
      set({ vaultQuery: q, vaultClips: shots, vaultBusy: false, vaultError: null });
    } catch (err) {
      const hits = local();
      set({
        vaultBusy: false,
        vaultClips: hits,
        vaultError: err instanceof Error ? err.message : "Vault search failed.",
      });
    }
  },
  removeUserClip: (id) => {
    const clip = get().userClips.find((item) => item.id === id);
    if (clip) URL.revokeObjectURL(clip.src);
    remember("upload", sliceOf(get()));
    const selectedClipIds = get().selectedClipIds.filter((item) => item !== id);
    set({
      userClips: get().userClips.filter((item) => item.id !== id),
      selectedClipIds,
    });
    syncSingleCut(get, set);
  },
  removeFromCut: (id) => {
    remember("cut", sliceOf(get()));
    set({ selectedClipIds: get().selectedClipIds.filter((item) => item !== id) });
    syncSingleCut(get, set);
  },
  clearStock: () => {
    const uploads = new Set(get().userClips.map((clip) => clip.id));
    remember("cut", sliceOf(get()));
    set({ selectedClipIds: get().selectedClipIds.filter((id) => uploads.has(id)) });
    syncSingleCut(get, set);
  },
  addCategoryToCut: (categoryId) => {
    const pack = PACKS.find((item) => item.id === categoryId);
    if (!pack) return;
    const ids = new Set(get().selectedClipIds);
    pack.clips.forEach((clip) => ids.add(clip.id));
    remember("cut", sliceOf(get()));
    set({ selectedClipIds: [...ids] });
    syncSingleCut(get, set);
  },
  toggleStyle: (id) => {
    const next = focusChoice(get().captionStyles, id);
    remember(`style:${id}`, sliceOf(get()));
    set({ captionStyles: next.length ? next : get().captionStyles });
  },
  toggleEffect: (id) => {
    const next = focusChoice(get().captionEffects, id);
    remember(`effect:${id}`, sliceOf(get()));
    set({ captionEffects: next.length ? next : get().captionEffects });
  },
  toggleFont: (id) => {
    const next = focusChoice(get().fonts, id);
    remember(`font:${id}`, sliceOf(get()));
    set({ fonts: next.length ? next : get().fonts });
  },
  toggleLook: (id) => {
    const next = focusChoice(get().looks, id);
    remember(`look:${id}`, sliceOf(get()));
    set({ looks: next.length ? next : get().looks });
  },
  toggleFraming: (id) => {
    const next = focusChoice(get().framings, id);
    remember(`frame:${id}`, sliceOf(get()));
    set({ framings: next.length ? next : get().framings });
  },
  setPacing: (pacing) => {
    remember("pacing", sliceOf(get()));
    set({ pacing });
  },
  setBatchSize: (batchSize) => {
    remember("batch", sliceOf(get()));
    set({ batchSize });
  },
  setMode: (mode) => {
    const { recipes, selectedId } = get();
    const single = recipes.find((recipe) => recipe.id === "single");
    const batch = recipes.find((recipe) => recipe.id !== "single");
    set({
      mode,
      selectedId: mode === "single" ? (single?.id ?? null) : selectedId === "single" ? (batch?.id ?? null) : selectedId,
    });
  },
  makeSingle: () => {
    const { analysis, region, captionStyles, captionEffects, fonts, looks, framings } = get();
    if (!analysis) return;
    const clips = get().clips();
    if (!clips.length) {
      set({ notice: "Add at least one clip first.", noticeError: false });
      return;
    }
    remember("generate", sliceOf(get()));
    const recipe = buildSingleRecipe({
      clipIds: clips.map((clip) => clip.id),
      region,
      analysis,
      style: captionStyles[0] ?? "word",
      font: fonts[0] ?? "brat",
      effect: captionEffects[0] ?? "none",
      look: looks[0] ?? "film",
      framing: framings[0] ?? "fill",
    });
    const batch = get().recipes.filter((recipe) => recipe.id !== "single");
    set({
      generating: false,
      recipes: [recipe, ...batch],
      selectedId: recipe.id,
      step: "edit",
      mode: "single",
      notice: "One video, in the order you picked. Drag clips to reorder or resize them.",
      noticeError: false,
    });
  },
  generate: () => {
    const { analysis, region, captionStyles, captionEffects, fonts, looks, framings, pacing, batchSize } = get();
    if (!analysis) return;
    remember("generate", sliceOf(get()));
    const clips = get().clips();
    const recipes = buildRecipes({
      count: batchSize,
      styles: captionStyles,
      fonts,
      effects: captionEffects,
      looks,
      framings,
      pacing,
      clipIds: clips.map((c) => c.id),
      region,
      analysis,
    });
    const single = get().recipes.find((recipe) => recipe.id === "single");
    set({
      generating: false,
      recipes: single ? [single, ...recipes] : recipes,
      step: "wall",
      mode: "batch",
      selectedId: recipes[0]?.id ?? null,
    });
  },
  cancelBatchExport: () => {
    batchAbort?.abort();
  },
  exportBatch: async () => {
    const state = get();
    const recipes = state.recipes.filter((recipe) => recipe.id !== "single");
    if (!state.audioUrl || !recipes.length || state.exporting) return;
    const controller = new AbortController();
    batchAbort = controller;
    const clipsFor = (target: Recipe) => {
      const extras = [...get().userClips, ...get().vaultClips];
      const ids = [...new Set([...(target.clipIds ?? []), ...get().selectedClipIds])];
      return resolveCutClips(ids, extras);
    };
    set({
      exporting: true,
      batchNote: null,
      batchRows: recipes.map((item) => ({ id: item.id, label: `${item.index + 1}`, progress: 0 })),
    });
    try {
      const blob = await exportRecipeBatch({
        recipes,
        clipsFor,
        lyrics: state.lyrics,
        audioUrl: state.audioUrl,
        start: state.region.start,
        end: state.region.end,
        captionPrefs: state.captionPrefs,
        signal: controller.signal,
        onItem: (row) => {
          set({
            batchRows: get().batchRows.map((item) => (item.id === row.id ? row : item)),
          });
        },
      });
      downloadZip(blob, `${slugTrack(state.trackName)}-batch.zip`);
      set({ batchNote: `Downloaded ${recipes.length} videos.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") set({ batchNote: "Export cancelled." });
      else set({ batchNote: err instanceof Error ? err.message : "Export failed" });
    } finally {
      batchAbort = null;
      set({ exporting: false });
    }
  },
  selectRecipe: (selectedId) => set({ selectedId, step: selectedId ? "edit" : "wall" }),
  updateSelected: (patch) => {
    const { recipes, selectedId } = get();
    const id = selectedId ?? recipes[0]?.id;
    if (!id) return;
    remember("recipe", sliceOf(get()));
    set({
      selectedId: id,
      recipes: recipes.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  },
  saveLyricVersion: (name) => {
    const { words, lyricDraft, region, trackName, lyricBank, analysis } = get();
    if (!words.length && !lyricDraft.trim()) return;
    const duration = analysis?.duration ?? 0;
    const version: LyricVersion = {
      id: `ly-${Date.now().toString(36)}`,
      name: name.trim() || `${trackName || "Track"} take`,
      savedAt: Date.now(),
      trackName: trackName || "Untitled",
      region: { ...region },
      words: words.map((w) => ({ ...w })),
      lyricDraft,
      duration,
      key: lyricKey(trackName || "Untitled", duration),
    };
    const next = [version, ...lyricBank].slice(0, 40);
    persistLyricBank(next);
    set({ lyricBank: next, activeLyricId: version.id, notice: `Saved “${version.name}” for this song.`, noticeError: false });
  },
  loadLyricVersion: (id) => {
    const version = get().lyricBank.find((v) => v.id === id);
    if (!version) return;
    remember("lyrics", sliceOf(get()));
    const duration = get().analysis?.duration;
    const region = duration ? clampRegion(version.region, duration) : { ...version.region };
    set({
      ...commitWords(version.words.map((w) => ({ ...w }))),
      lyricDraft: version.lyricDraft,
      region,
      lyricsDirty: false,
      transcribeSource: "manual",
      selectedWordId: null,
      activeLyricId: version.id,
      lastTranscribedRegion: region,
      notice: `Loaded “${version.name}”.`,
      noticeError: false,
    });
  },
  deleteLyricVersion: (id) => {
    const next = get().lyricBank.filter((v) => v.id !== id);
    persistLyricBank(next);
    set({ lyricBank: next, activeLyricId: get().activeLyricId === id ? null : get().activeLyricId });
  },
  setSegmentClip: (segment, clipId) =>
    patchOpenRecipe(get, set, (recipe) => {
      const clipIds = recipe.clipIds.length ? [...recipe.clipIds] : fallbackClipIds(recipe, get().clips());
      if (!clipIds.length) return recipe;
      const i = Math.max(0, Math.min(clipIds.length - 1, segment));
      clipIds[i] = clipId;
      return { ...recipe, clipIds };
    }),
  moveRecipeCut: (index, time) =>
    patchOpenRecipe(get, set, (recipe) => ({
      ...recipe,
      cutsEdited: true,
      cuts: moveCutTime(recipe.cuts, index, time),
    })),
  moveRecipeSegment: (from, dropTime) =>
    patchOpenRecipe(get, set, (recipe) => {
      const clipIds = recipe.clipIds.length ? recipe.clipIds : fallbackClipIds(recipe, get().clips());
      const next = moveSegmentTo(recipe.cuts, clipIds, from, dropTime);
      return next ? { ...recipe, ...next, cutsEdited: true } : recipe;
    }),
  splitRecipeAt: (time) =>
    patchOpenRecipe(get, set, (recipe) => {
      const clipIds = recipe.clipIds.length ? recipe.clipIds : fallbackClipIds(recipe, get().clips());
      const next = splitCuts(recipe.cuts, clipIds, time);
      return next ? { ...recipe, ...next, cutsEdited: true } : recipe;
    }),
  removeRecipeCut: (index) =>
    patchOpenRecipe(get, set, (recipe) => {
      const clipIds = recipe.clipIds.length ? recipe.clipIds : fallbackClipIds(recipe, get().clips());
      const next = removeCutAt(recipe.cuts, clipIds, index);
      return next ? { ...recipe, ...next, cutsEdited: true } : recipe;
    }),
  clips: () => resolveCutClips(get().selectedClipIds, [...get().userClips, ...get().vaultClips]),
  selected: () => get().recipes.find((r) => r.id === get().selectedId) ?? null,
  reset: () => {
    clearHistory();
    const prev = get().audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    get().userClips.forEach((c) => URL.revokeObjectURL(c.src));
    clearVocalStemCache();
    setDecodedAudio(null);
    set({
      ...defaults,
      lyricBank: get().lyricBank,
      activeLyricId: null,
      selectedClipIds: [...DEFAULT_CUT_IDS],
      captionPrefs: { ...DEFAULT_CAPTION_PREFS },
      lyricDraft: "",
      canUndo: false,
      canRedo: false,
    });
  },
  undo: () => {
    const prev = popUndo(sliceOf(get()));
    if (!prev) return;
    set({ ...prev, ...historyFlags() });
  },
  redo: () => {
    const next = popRedo(sliceOf(get()));
    if (!next) return;
    set({ ...next, ...historyFlags() });
  },
  beginEdit: (key) => beginGesture(key, sliceOf(get())),
  endEdit: () => {
    endGesture();
    flushTouch(get, set);
  },
}));

onHistory(() => {
  const flags = historyFlags();
  const cur = useStudio.getState();
  if (cur.canUndo !== flags.canUndo || cur.canRedo !== flags.canRedo) useStudio.setState(flags);
});

async function runTranscribe(gen: number) {
  const state = useStudio.getState();
  if (!state.analysis) {
    useStudio.setState({ transcribing: false, transcribeStatus: "" });
    return;
  }
  setHearing(true);
  try {
    const result = await transcribeRegion(state.region, state.analysis, {
      audioUrl: state.audioUrl,
      trackName: state.trackName,
      isolate: state.isolateVocals,
      onStatus: (msg) => {
        const latest = useStudio.getState();
        if (latest.transcribeGen !== gen) return;
        useStudio.setState({ transcribeStatus: msg });
      },
    });
    const latest = useStudio.getState();
    if (latest.transcribeGen !== gen) return;
    if (!result.words.length) {
      useStudio.setState({
        transcribing: false,
        transcribeStatus: "",
        notice: result.warning ?? "Couldn’t hear vocals in this clip.",
        noticeError: true,
      });
      return;
    }
    remember("hear", sliceOf(latest));
    useStudio.setState({
      ...commitWords(result.words),
      transcribing: false,
      transcribeSource: result.source,
      transcribeStatus: "",
      notice: result.warning,
      noticeError: false,
      selectedWordId: null,
      lastTranscribedRegion: latest.region,
      lyricsDirty: false,
    });
  } finally {
    setHearing(false);
  }
}

export function captionSizeLabel(id: CaptionSizeId) {
  return id === "s" ? "Small" : id === "l" ? "Large" : "Medium";
}
export function captionPosLabel(id: CaptionPosId) {
  return id === "top" ? "Top" : id === "low" ? "Low" : "Middle";
}
export function captionCaseLabel(id: CaptionCaseId) {
  return id === "upper" ? "Upper" : "As sung";
}
