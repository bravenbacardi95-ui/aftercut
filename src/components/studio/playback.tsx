import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { useStudio } from "@/lib/studio/store";
import { armLoop, setTransportHot } from "@/lib/studio/yield";
import type { Region } from "@/lib/studio/types";

type SeekOpts = { bounds?: Region; play?: boolean };

type PlaybackApi = {
  audioRef: RefObject<HTMLAudioElement | null>;
  timeRef: MutableRefObject<number>;
  playingRef: MutableRefObject<boolean>;
  playing: boolean;
  toggle: () => Promise<void>;
  seek: (t: number, opts?: SeekOpts) => void;
  playFrom: (t: number, bounds?: Region) => Promise<void>;
  restart: () => Promise<void>;
  pause: () => void;
  setScrubbing: (on: boolean) => void;
};

const PlaybackContext = createContext<PlaybackApi | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const audioUrl = useStudio((s) => s.audioUrl);
  const region = useStudio((s) => s.region);
  const regionRef = useRef(region);
  regionRef.current = region;
  const scrubbingRef = useRef(false);

  const markPlaying = useCallback((on: boolean) => {
    playingRef.current = on;
    setTransportHot(on);
    setPlaying(on);
  }, []);

  useEffect(() => {
    return armLoop(() => {
      const a = audioRef.current;
      const r = regionRef.current;
      if (a) {
        if (!scrubbingRef.current && !a.paused && a.currentTime >= r.end - 0.02) {
          a.currentTime = r.start;
        }
        timeRef.current = a.currentTime;
      }
    });
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.currentTime < region.start || a.currentTime >= region.end) {
      a.currentTime = region.start;
      timeRef.current = region.start;
    }
  }, [audioUrl]);

  const playFrom = useCallback(async (t: number, bounds?: Region) => {
    const a = audioRef.current;
    if (!a) return;
    const r = bounds ?? regionRef.current;
    regionRef.current = r;
    const clamped = Math.max(r.start, Math.min(r.end - 0.01, t));
    a.currentTime = clamped;
    timeRef.current = clamped;
    try {
      await a.play();
      markPlaying(true);
    } catch {
      markPlaying(false);
    }
  }, [markPlaying]);

  const seek = useCallback(
    (t: number, opts?: SeekOpts) => {
      const r = opts?.bounds ?? regionRef.current;
      const a = audioRef.current;
      const max = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration - 0.01 : r.end - 0.01;
      const clamped = Math.max(r.start, Math.min(Math.min(r.end - 0.01, max), t));
      if (a) a.currentTime = clamped;
      timeRef.current = clamped;
      if (opts?.play) void playFrom(clamped, r);
    },
    [playFrom],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    markPlaying(false);
  }, [markPlaying]);

  const restart = useCallback(async () => {
    await playFrom(regionRef.current.start);
  }, [playFrom]);

  const toggle = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    const r = regionRef.current;
    if (!a.paused) {
      a.pause();
      markPlaying(false);
      return;
    }
    if (a.currentTime < r.start || a.currentTime >= r.end - 0.02) a.currentTime = r.start;
    try {
      await a.play();
      markPlaying(true);
    } catch {
      markPlaying(false);
    }
  }, [markPlaying]);

  const setScrubbing = useCallback((on: boolean) => {
    scrubbingRef.current = on;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el instanceof HTMLElement && el.isContentEditable)) return;
      if (el?.closest("button, a, [role='button']")) return;
      if (e.code === "Space") {
        e.preventDefault();
        void toggle();
      } else if (e.key === "Home") {
        e.preventDefault();
        void restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, restart]);

  const value = useMemo(
    () => ({ audioRef, timeRef, playingRef, playing, toggle, seek, playFrom, restart, pause, setScrubbing }),
    [playing, toggle, seek, playFrom, restart, pause, setScrubbing],
  );

  return (
    <PlaybackContext.Provider value={value}>
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onEnded={() => markPlaying(false)}
        onPause={() => markPlaying(false)}
        onPlay={() => markPlaying(true)}
      />
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("PlaybackProvider missing");
  return ctx;
}

export function useTimeDisplay(fps = 8) {
  const { timeRef } = usePlayback();
  const [time, setTime] = useState(timeRef.current);
  useEffect(() => {
    const id = window.setInterval(() => setTime(timeRef.current), Math.round(1000 / fps));
    return () => window.clearInterval(id);
  }, [fps, timeRef]);
  return time;
}
