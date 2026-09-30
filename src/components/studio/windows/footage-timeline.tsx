import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PACKS, resolveCutClips } from "@/lib/studio/packs";
import { segmentIndexAt } from "@/lib/studio/recipes";
import { useStudio } from "@/lib/studio/store";
import type { MediaClip } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { armLoop } from "@/lib/studio/yield";
import { usePlayback } from "../playback";

export function FootageTimeline() {
  const recipe = useStudio((s) =>
    s.mode === "single"
      ? (s.recipes.find((r) => r.id === "single") ?? null)
      : (s.recipes.find((r) => r.id === s.selectedId && r.id !== "single") ?? s.recipes.find((r) => r.id !== "single") ?? null),
  );
  const mode = useStudio((s) => s.mode);
  const region = useStudio((s) => s.region);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const setSegmentClip = useStudio((s) => s.setSegmentClip);
  const moveRecipeCut = useStudio((s) => s.moveRecipeCut);
  const moveRecipeSegment = useStudio((s) => s.moveRecipeSegment);
  const splitRecipeAt = useStudio((s) => s.splitRecipeAt);
  const removeRecipeCut = useStudio((s) => s.removeRecipeCut);
  const beginEdit = useStudio((s) => s.beginEdit);
  const endEdit = useStudio((s) => s.endEdit);
  const { timeRef, seek } = usePlayback();
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [segment, setSegment] = useState(0);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ index: number; x: number } | null>(null);

  const extras = [...userClips, ...vaultClips];
  const pool = resolveCutClips(
    [...new Set([...selectedClipIds, ...PACKS.flatMap((p) => p.clips.map((c) => c.id))])],
    extras,
  );
  const byId = new Map(pool.map((c) => [c.id, c]));

  useEffect(() => {
    return armLoop(() => {
      const el = playhead.current;
      const root = track.current;
      if (el && root && recipe) {
        const span = Math.max(0.2, region.end - region.start);
        const x = ((timeRef.current - region.start) / span) * root.clientWidth;
        el.style.transform = `translate3d(${x}px,0,0)`;
      }
    });
  }, [timeRef, recipe, region.start, region.end]);

  if (!recipe) {
    return (
      <div className="flex h-28 shrink-0 items-center border-t border-border px-4 text-sm text-muted">
        {mode === "single" ? "Add a clip above, then drag it into place." : "Build a batch, then open a video to recut its footage."}
      </div>
    );
  }

  const cuts = recipe.cuts?.length ? recipe.cuts : [region.start, region.end];
  const clipIds = recipe.clipIds ?? [];
  const span = Math.max(0.2, region.end - region.start);
  const active = Math.max(0, Math.min(clipIds.length - 1, segment));
  const current = byId.get(clipIds[active] ?? "");

  const timeAt = (clientX: number) => {
    const el = track.current;
    if (!el) return region.start;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return region.start + x * span;
  };

  const dragCut = (index: number, ev: ReactPointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    beginEdit("footage");
    const move = (e: PointerEvent) => moveRecipeCut(index, timeAt(e.clientX));
    const up = () => {
      endEdit();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-44 shrink-0 flex-col border-t border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Footage timeline</p>
        <span className="truncate text-xs text-muted">
          Version {recipe.index + 1}
          {current ? ` · ${current.name}` : ""}
        </span>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => splitRecipeAt(timeRef.current)}>
            <Scissors className="size-3.5" />
            Split
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={cuts.length <= 2}
            onClick={() => removeRecipeCut(active + 1)}
          >
            <Trash2 className="size-3.5" />
            Join
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            Replace
          </Button>
        </div>
      </div>
      <div
        ref={track}
        className="relative mx-3 h-12 shrink-0 touch-none overflow-hidden rounded-md bg-elevated"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-cut]")) return;
          const t = timeAt(e.clientX);
          seek(t, { bounds: region });
          setSegment(segmentIndexAt(cuts, t));
        }}
      >
        {clipIds.map((id, i) => {
          const start = cuts[i] ?? region.start;
          const end = cuts[i + 1] ?? region.end;
          const left = ((start - region.start) / span) * 100;
          const width = ((end - start) / span) * 100;
          const clip = byId.get(id);
          const dragging = drag?.index === i;
          return (
            <div
              key={`${id}-${i}`}
              className={cn(
                "absolute inset-y-1 overflow-hidden rounded",
                dragging ? "z-30 shadow-[0_8px_24px_rgba(0,0,0,0.45)]" : drag ? "opacity-30 grayscale" : i === active ? "z-10 shadow-[0_0_0_1px_rgba(236,231,220,0.9)]" : "opacity-90",
              )}
              style={dragging ? { left: `${drag.x}%`, width: `${Math.max(width, 0.4)}%` } : { left: `${left}%`, width: `${Math.max(width, 0.4)}%` }}
            >
              <button
                type="button"
                className="absolute inset-y-0 left-2 right-2 cursor-grab overflow-hidden text-left active:cursor-grabbing"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setSegment(i);
                  const originX = e.clientX;
                  const el = track.current;
                  const rect = el?.getBoundingClientRect();
                  let moved = false;
                  beginEdit("footage");
                  const move = (ev: PointerEvent) => {
                    if (!rect) return;
                    if (Math.abs(ev.clientX - originX) > 4) moved = true;
                    if (!moved) return;
                    const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 100;
                    setDrag({ index: i, x: Math.max(0, x - width / 2) });
                  };
                  const up = (ev: PointerEvent) => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    if (moved) moveRecipeSegment(i, timeAt(ev.clientX));
                    else seek(start, { bounds: region });
                    setDrag(null);
                    endEdit();
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              >
                {clip?.poster || clip?.kind === "image" ? (
                  <img src={clip.poster ?? clip.src} alt="" className="pointer-events-none h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center bg-bg/40 px-1 text-[10px] text-fg">{clip?.name ?? "Clip"}</span>
                )}
                <span className="pointer-events-none absolute bottom-0 left-0 right-0 truncate bg-bg/70 px-1 text-[9px] text-fg">{clip?.name ?? "Clip"}</span>
              </button>
              <button
                type="button"
                aria-label="Shorten or extend the start"
                className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
                onPointerDown={(e) => dragCut(i, e)}
              />
              <button
                type="button"
                aria-label="Shorten or extend the end"
                className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
                onPointerDown={(e) => dragCut(i + 1, e)}
              />
            </div>
          );
        })}
        {cuts.slice(1, -1).map((t, i) => (
          <div
            key={`cut-${i}`}
            data-cut=""
            role="slider"
            aria-label="Move cut"
            className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${((t - region.start) / span) * 100}%` }}
            onPointerDown={(e) => dragCut(i + 1, e)}
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-playhead" />
          </div>
        ))}
        <div ref={playhead} className="pointer-events-none absolute inset-y-0 z-20 w-px bg-playhead will-change-transform" />
      </div>
      {open ? (
        <div className="min-h-0 flex-1 overflow-x-scroll px-3 py-2">
          <div className="flex h-full gap-1.5">
            {pool.map((clip) => (
              <SwapThumb
                key={clip.id}
                clip={clip}
                active={clip.id === clipIds[active]}
                onPick={() => {
                  setSegmentClip(active, clip.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="px-3 py-1 text-[11px] text-subtle">
          Hold a clip and drag it to a new spot. Drag the edges to change its length.
        </p>
      )}
    </div>
  );
}

function SwapThumb({ clip, active, onPick }: { clip: MediaClip; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "h-full w-10 shrink-0 overflow-hidden rounded",
        active ? "shadow-[0_0_0_1px_rgba(236,231,220,0.9)]" : "opacity-80",
      )}
      title={clip.name}
    >
      {clip.poster || clip.kind === "image" ? (
        <img src={clip.poster ?? clip.src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center bg-elevated text-[9px] text-muted">Clip</span>
      )}
    </button>
  );
}
