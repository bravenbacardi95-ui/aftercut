import { useEffect, useRef, type MutableRefObject } from "react";
import { drawFrame, ensureCaptionFonts } from "@/lib/studio/compositor";
import { playCutVideos, setPackVideoPlaying, mediaGeneration, getVideo } from "@/lib/studio/media";
import { clipForRecipe } from "@/lib/studio/recipes";
import { useStudio } from "@/lib/studio/store";
import { DEFAULT_CAPTION_PREFS, type CaptionPrefs, type LyricLine, type MediaClip, type Recipe } from "@/lib/studio/types";

const PREVIEW_W = 270;
const PREVIEW_H = 480;

export function PlayerCanvas({
  recipe,
  clips,
  lyrics,
  time,
  timeRef,
  playingRef,
  captionPrefs,
  className,
}: {
  recipe: Recipe;
  clips: MediaClip[];
  lyrics: LyricLine[];
  time?: number;
  timeRef?: MutableRefObject<number>;
  playingRef?: MutableRefObject<boolean>;
  captionPrefs?: CaptionPrefs;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const localTime = useRef(time ?? 0);
  if (time != null) localTime.current = time;
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const lyricsRef = useRef(lyrics);
  lyricsRef.current = lyrics;
  const prefsRef = useRef(captionPrefs ?? DEFAULT_CAPTION_PREFS);
  prefsRef.current = captionPrefs ?? DEFAULT_CAPTION_PREFS;

  useEffect(() => {
    ensureCaptionFonts();
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    let id = 0;
    let timer = 0;
    let alive = true;
    let lastT = -1;
    let lastPlaying = false;
    let lastKey = "";
    let lastVideoKey = "";
    let lastDraw = 0;
    let lastGen = -1;
    const loop = (now: number) => {
      if (!alive) return;
      if (useStudio.getState().exporting) {
        id = requestAnimationFrame(loop);
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        if (lastVideoKey) {
          setPackVideoPlaying(false);
          lastVideoKey = "";
        }
        id = requestAnimationFrame(loop);
        return;
      }
      if (useStudio.getState().transcribing) {
        if (lastVideoKey) {
          setPackVideoPlaying(false);
          lastVideoKey = "";
        }
        timer = window.setTimeout(() => {
          id = requestAnimationFrame(loop);
        }, 400);
        return;
      }
      const t = timeRef?.current ?? localTime.current;
      const playing = playingRef?.current ?? false;
      const rec = recipeRef.current;
      const clipsNow = clipsRef.current;
      const active = clipForRecipe(rec, clipsNow, t) ?? clipsNow[0];
      const activeSrc = active?.kind === "video" ? active.src : null;
      const videoLive = Boolean(activeSrc);
      const gen = mediaGeneration();
      const prefs = prefsRef.current;
      const key = `${rec.id}:${rec.captionStyle}:${rec.font}:${rec.effect}:${rec.look}:${rec.framing}:${lyricsRef.current.length}:${prefs.size}${prefs.position}${prefs.textCase}${prefs.bratPlate}${prefs.bratFootage ? 1 : 0}${prefs.bratFade ? 1 : 0}:${gen}`;
      const moved = Math.abs(t - lastT) > 0.008;
      const dirty = key !== lastKey || playing !== lastPlaying || gen !== lastGen;
      const frameGap = 32;
      if (!playing && !moved && !dirty && !videoLive) {
        id = requestAnimationFrame(loop);
        return;
      }
      if (now - lastDraw < frameGap && !dirty) {
        id = requestAnimationFrame(loop);
        return;
      }
      const videoSrcs = clipsNow.filter((clip) => clip.kind === "video").map((clip) => clip.src);
      const activeIndex = activeSrc ? videoSrcs.indexOf(activeSrc) : -1;
      const upcoming = activeIndex >= 0 ? (videoSrcs[activeIndex + 1] ?? null) : (videoSrcs[0] ?? null);
      const videoKey = `${activeSrc ?? ""}>${upcoming ?? ""}`;
      if (videoKey !== lastVideoKey) {
        playCutVideos([activeSrc, upcoming].filter((src): src is string => Boolean(src)), activeSrc);
        lastVideoKey = videoKey;
      } else if (activeSrc && getVideo(activeSrc).paused) {
        playCutVideos([activeSrc, upcoming].filter((src): src is string => Boolean(src)), activeSrc);
      }
      lastT = t;
      lastPlaying = playing;
      lastKey = key;
      lastGen = gen;
      lastDraw = now;
      try {
        drawFrame(ctx, {
          recipe: rec,
          clips: clipsRef.current,
          lyrics: lyricsRef.current,
          time: t,
          width: canvas.width,
          height: canvas.height,
          captionPrefs: prefsRef.current,
          quality: "preview",
        });
      } catch {
        /* skip a bad frame instead of locking the studio */
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
      window.clearTimeout(timer);
      if (!useStudio.getState().exporting) setPackVideoPlaying(false);
    };
  }, [timeRef, playingRef]);

  return (
    <canvas
      ref={ref}
      width={PREVIEW_W}
      height={PREVIEW_H}
      className={className ?? "absolute inset-0 h-full w-full"}
      aria-label="Video preview"
    />
  );
}
