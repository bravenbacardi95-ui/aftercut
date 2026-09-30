export type CaptionStyleId = "word" | "line" | "karaoke" | "typewriter";
export type CaptionEffectId = "none" | "outline" | "boxed";
export type CaptionFontId = "brat" | "clean" | "editorial" | "poster";
export type LookId = "clean" | "film" | "crush" | "cool" | "fade";
export type FramingId = "fill" | "offset" | "letterbox" | "punch";
export type PacingId = "smart" | "steady" | "energy";
export type StudioStep = "track" | "setup" | "footage" | "vary" | "wall" | "edit";
export type CaptionSizeId = "s" | "m" | "l";
export type CaptionPosId = "top" | "mid" | "low";
export type CaptionCaseId = "as-is" | "upper";
export type TranscribeSource = "stt" | "aligned" | "manual" | null;
export type ClipOrigin = "stock" | "upload";
export type FootageTab = "stock" | "upload";

export type LyricWord = {
  id: string;
  text: string;
  start: number;
  end: number;
  line: number;
  lowConfidence?: boolean;
  confidence?: number;
};

export type LyricLine = {
  id: string;
  text: string;
  start: number;
  end: number;
  words: LyricWord[];
};

export type CaptionPrefs = {
  size: CaptionSizeId;
  position: CaptionPosId;
  textCase: CaptionCaseId;
};

export type MediaClip = {
  id: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
  name: string;
  origin: ClipOrigin;
  categoryId?: string;
};

export type Pack = {
  id: string;
  name: string;
  description: string;
  poster: string;
  clips: MediaClip[];
};

export type AudioAnalysis = {
  duration: number;
  bpm: number;
  beats: number[];
  onsets: number[];
  energy: number[];
  energyHop: number;
};

export type Recipe = {
  id: string;
  index: number;
  captionStyle: CaptionStyleId;
  font: CaptionFontId;
  effect: CaptionEffectId;
  look: LookId;
  framing: FramingId;
  pacing: PacingId;
  seed: number;
  clipOrder: number[];
  /** One clip id per segment between cuts. Owned by this version. */
  clipIds: string[];
  cuts: number[];
  /** Split, join, or a dragged cut. Snippet moves shift these instead of rebuilding them. */
  cutsEdited?: boolean;
};

export type Region = { start: number; end: number };

export const DEFAULT_CAPTION_PREFS: CaptionPrefs = {
  size: "m",
  position: "mid",
  textCase: "as-is",
};

export const MIN_WORD_DUR = 0.04;
export const MIN_REGION = 3;
export const MAX_REGION = 45;
