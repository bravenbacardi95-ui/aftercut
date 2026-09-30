import type { LyricWord, Region } from "./types";

export type LyricVersion = {
  id: string;
  name: string;
  savedAt: number;
  trackName: string;
  region: Region;
  words: LyricWord[];
  lyricDraft: string;
  duration?: number;
  key?: string;
};

const KEY = "aftercut-lyric-bank";

export function lyricKey(trackName: string, duration: number) {
  const name = trackName
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "");
  const dur = Number.isFinite(duration) ? duration.toFixed(2) : "0";
  return `${name}:${dur}`;
}

export function findSavedLyrics(bank: LyricVersion[], trackName: string, duration: number): LyricVersion | null {
  if (!bank.length) return null;
  const key = lyricKey(trackName, duration);
  const name = key.slice(0, key.lastIndexOf(":"));
  const exact = bank.filter((v) => v.key === key);
  const loose = bank.filter((v) => {
    const theirs = (v.key ?? lyricKey(v.trackName, v.duration ?? duration)).split(":")[0];
    if (theirs !== name) return false;
    if (v.duration == null) return true;
    return Math.abs(v.duration - duration) < 1.25;
  });
  const pool = exact.length ? exact : loose;
  if (!pool.length) return null;
  return [...pool].sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

export function loadLyricBank(): LyricVersion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LyricVersion[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => v && typeof v.id === "string" && Array.isArray(v.words)).slice(0, 40);
  } catch {
    return [];
  }
}

export function persistLyricBank(versions: LyricVersion[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(versions.slice(0, 40)));
  } catch {
    /* quota */
  }
}
