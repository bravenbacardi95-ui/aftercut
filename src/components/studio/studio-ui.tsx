import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pause, Play, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerCanvas } from "@/components/studio/player-canvas";
import { formatTime } from "@/lib/studio/beats";
import { bratSampleTime, drawFrame, ensureCaptionFonts } from "@/lib/studio/compositor";
import { getImage } from "@/lib/studio/media";
import { PACKS, resolveCutClips } from "@/lib/studio/packs";
import { buildRecipes, buildSingleRecipe } from "@/lib/studio/recipes";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";
import type { LyricLine, Recipe } from "@/lib/studio/types";
import { usePlayback } from "./playback";
import { armLoop } from "@/lib/studio/yield";

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150",
        active ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function PhonePreview({ recipe, className }: { recipe: Recipe | null; className?: string }) {
  const { timeRef, playingRef } = usePlayback();
  const lyrics = useStudio((s) => s.lyrics);
  const captionPrefs = useStudio((s) => s.captionPrefs);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const extras = [...userClips, ...vaultClips];
  const base = resolveCutClips(selectedClipIds, extras);
  const missing = (recipe?.clipIds ?? []).filter((id) => !base.some((c) => c.id === id));
  const clips = missing.length ? [...base, ...resolveCutClips(missing, extras)] : base;
  const poster = clips[0]?.poster ?? clips[0]?.src ?? PACKS[0].poster;
  return (
    <div
      className={cn(
        "relative aspect-[9/16] w-full overflow-hidden rounded-phone bg-bg shadow-[0_0_0_1px_rgba(242,239,232,0.12)]",
        className,
      )}
    >
      {recipe ? (
        <PlayerCanvas
          recipe={recipe}
          clips={clips}
          lyrics={lyrics}
          timeRef={timeRef}
          playingRef={playingRef}
          captionPrefs={captionPrefs}
        />
      ) : (
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

export function PhoneStage({ recipe, size = "md" }: { recipe: Recipe | null; size?: "sm" | "md" }) {
  const width = size === "sm" ? "w-28" : "w-40";
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-hidden p-2">
      <div className={cn("shrink-0 overflow-hidden", width)}>
        <PhonePreview recipe={recipe} />
      </div>
    </div>
  );
}

export function usePreviewRecipe(): Recipe | null {
  const recipes = useStudio((s) => s.recipes);
  const selectedId = useStudio((s) => s.selectedId);
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const captionStyles = useStudio((s) => s.captionStyles);
  const captionEffects = useStudio((s) => s.captionEffects);
  const fonts = useStudio((s) => s.fonts);
  const looks = useStudio((s) => s.looks);
  const framings = useStudio((s) => s.framings);
  const pacing = useStudio((s) => s.pacing);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const mode = useStudio((s) => s.mode);
  const single = recipes.find((recipe) => recipe.id === "single") ?? null;
  const selected = recipes.find((r) => r.id === selectedId) ?? null;
  if (mode === "single") {
    if (single) return single;
    if (!analysis) return null;
    return buildSingleRecipe({
      clipIds: selectedClipIds.length ? selectedClipIds : ["clip"],
      region,
      analysis,
      style: captionStyles[0] ?? "brat",
      font: fonts[0] ?? "brat",
      effect: captionEffects[0] ?? "none",
      look: looks[0] ?? "film",
      framing: framings[0] ?? "fill",
    });
  }
  if (selected) return selected;
  if (recipes[0]) return recipes[0];
  if (!analysis) return null;
  return (
    buildRecipes({
      count: 1,
      styles: captionStyles,
      fonts,
      effects: captionEffects,
      looks,
      framings,
      pacing,
      clipIds: selectedClipIds.length ? selectedClipIds : ["clip"],
      region,
      analysis,
    })[0] ?? null
  );
}

export function useLivePreview(): Recipe | null {
  const base = usePreviewRecipe();
  const recipes = useStudio((s) => s.recipes);
  const font = useStudio((s) => s.fonts[0]);
  const captionStyle = useStudio((s) => s.captionStyles[0]);
  const effect = useStudio((s) => s.captionEffects[0]);
  const look = useStudio((s) => s.looks[0]);
  const framing = useStudio((s) => s.framings[0]);
  return useMemo(() => {
    if (!base) return null;
    if (recipes.some((recipe) => recipe.id === base.id)) return base;
    return {
      ...base,
      font: font ?? base.font,
      captionStyle: captionStyle ?? base.captionStyle,
      effect: effect ?? base.effect,
      look: look ?? base.look,
      framing: framing ?? base.framing,
    };
  }, [base, recipes, font, captionStyle, effect, look, framing]);
}

export function Transport({ compact = false }: { compact?: boolean }) {
  const { playing, toggle, restart, timeRef } = usePlayback();
  const region = useStudio((s) => s.region);
  const timeEl = useRef<HTMLSpanElement>(null);
  const endLabel = formatTime(region.end);

  useEffect(() => {
    let last = "";
    return armLoop(() => {
      const next = `${formatTime(timeRef.current)} / ${endLabel}`;
      if (timeEl.current && next !== last) {
        timeEl.current.textContent = next;
        last = next;
      }
    });
  }, [timeRef, endLabel]);

  return (
    <div className={cn("flex shrink-0 items-center gap-2", compact ? "w-full flex-col" : "justify-between")}>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={() => void restart()} aria-label="Play from start">
          <SkipBack className="size-4" />
          {compact ? null : "Start"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void toggle()} className={compact ? "min-w-20" : "min-w-24"}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
      </div>
      <span ref={timeEl} className="font-mono text-xs tabular-nums text-muted">
        {formatTime(0)} / {endLabel}
      </span>
    </div>
  );
}

export const RecipeThumb = memo(function RecipeThumb({ recipe }: { recipe: Recipe }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const lyrics = useStudio((s) => s.lyrics);
  const captionPrefs = useStudio((s) => s.captionPrefs);
  const clipKey = recipe.clipIds.join("|");
  const lyricKey = lyrics.map((line) => `${line.id}:${line.text}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ensureCaptionFonts();
    const extras = [...userClips, ...vaultClips];
    const ids = [...new Set([...(recipe.clipIds ?? []), ...selectedClipIds])];
    const clips = resolveCutClips(ids.length ? ids : selectedClipIds, extras);
    const width = 180;
    const height = 320;
    canvas.width = width;
    canvas.height = height;
    let dead = false;
    const paint = () => {
      if (dead) return;
      drawFrame(ctx, {
        recipe,
        clips,
        lyrics,
        time: firstCaptionTime(recipe, lyrics),
        width,
        height,
        captionPrefs,
        quality: "preview",
      });
    };
    paint();
    const unsubs: Array<() => void> = [];
    for (const clip of clips) {
      const src = clip.poster || (clip.kind === "image" ? clip.src : "");
      if (!src) continue;
      const img = getImage(src);
      if (!img.complete) {
        const onLoad = () => paint();
        img.addEventListener("load", onLoad);
        unsubs.push(() => img.removeEventListener("load", onLoad));
      }
    }
    const retry = window.setTimeout(paint, 500);
    return () => {
      dead = true;
      window.clearTimeout(retry);
      unsubs.forEach((fn) => fn());
    };
  }, [recipe, clipKey, lyricKey, lyrics, captionPrefs, selectedClipIds, userClips, vaultClips]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`${recipe.font} ${recipe.captionStyle} ${recipe.look}`}
      className="block aspect-[9/16] w-full bg-bg"
    />
  );
});

function firstCaptionTime(recipe: Recipe, lyrics: LyricLine[]) {
  const start = recipe.cuts[0] ?? 0;
  const end = recipe.cuts[recipe.cuts.length - 1] ?? start + 1;
  if (recipe.captionStyle === "brat") return bratSampleTime(lyrics, start, end);
  for (const line of lyrics) {
    for (const word of line.words) {
      if (word.end > start && word.start < end) return Math.max(start, word.start) + Math.min(0.08, Math.max(0.02, (word.end - word.start) * 0.35));
    }
  }
  return start + 0.12;
}
