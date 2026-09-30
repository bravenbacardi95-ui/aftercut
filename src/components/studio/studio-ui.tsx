import { memo, useEffect, useRef, type ReactNode } from "react";
import { Pause, Play, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerCanvas } from "@/components/studio/player-canvas";
import { formatTime } from "@/lib/studio/beats";
import { PACKS, resolveCutClips } from "@/lib/studio/packs";
import { buildRecipes, buildSingleRecipe } from "@/lib/studio/recipes";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";
import type { Recipe } from "@/lib/studio/types";
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
      style: captionStyles[0] ?? "word",
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
  const font = useStudio((s) => s.fonts[0]);
  const captionStyle = useStudio((s) => s.captionStyles[0]);
  const effect = useStudio((s) => s.captionEffects[0]);
  const look = useStudio((s) => s.looks[0]);
  const framing = useStudio((s) => s.framings[0]);
  if (!base) return null;
  return {
    ...base,
    font: font ?? base.font,
    captionStyle: captionStyle ?? base.captionStyle,
    effect: effect ?? base.effect,
    look: look ?? base.look,
    framing: framing ?? base.framing,
  };
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
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const lyrics = useStudio((s) => s.lyrics);
  const clips = resolveCutClips(selectedClipIds, [...userClips, ...vaultClips]);
  const poster = clips[recipe.index % Math.max(1, clips.length)]?.poster ?? clips[0]?.src ?? PACKS[0].poster;
  const line = lyrics[recipe.index % Math.max(1, lyrics.length)]?.text ?? "";
  const brat = recipe.font === "brat";
  const filter =
    recipe.look === "film"
      ? "sepia(0.25) contrast(1.08)"
      : recipe.look === "crush"
        ? "contrast(1.3) saturate(0.75)"
        : recipe.look === "cool"
          ? "saturate(0.7) hue-rotate(12deg)"
          : recipe.look === "fade"
            ? "contrast(0.88) brightness(1.08)"
            : "none";
  const fontClass =
    recipe.font === "brat"
      ? "font-brat lowercase"
      : recipe.font === "editorial"
        ? "font-serif italic"
        : recipe.font === "poster"
          ? "font-poster uppercase"
          : "font-sans";
  return (
    <span className="relative block aspect-[9/16] w-full bg-bg">
      <img src={poster} alt="" className="h-full w-full object-cover" style={{ filter }} />
      <span
        className={`absolute inset-x-1 bottom-2 text-center text-[0.55rem] font-bold leading-tight drop-shadow ${fontClass} ${brat ? "text-[#8ACE00]" : "text-fg"}`}
      >
        {line}
      </span>
    </span>
  );
});
