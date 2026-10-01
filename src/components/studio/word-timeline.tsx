import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Magnet, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrecise } from "@/lib/studio/beats";
import { wordsInRegion } from "@/lib/studio/lyrics";
import { useStudioLayout } from "@/lib/studio/layout";
import { useStudio } from "@/lib/studio/store";
import { downsampleEnergy } from "@/lib/studio/waveform";
import { cn } from "@/lib/utils";
import { armLoop } from "@/lib/studio/yield";
import { usePlayback } from "./playback";
import type { LyricWord } from "@/lib/studio/types";

const CHIP = ["bg-lyric-a", "bg-lyric-b", "bg-lyric-c", "bg-lyric-d"] as const;

export function WordTimeline() {
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const words = useStudio((s) => s.words);
  const selectedWordId = useStudio((s) => s.selectedWordId);
  const selectWord = useStudio((s) => s.selectWord);
  const beginEdit = useStudio((s) => s.beginEdit);
  const endEdit = useStudio((s) => s.endEdit);
  const resizeWordEdge = useStudio((s) => s.resizeWordEdge);
  const moveWordTo = useStudio((s) => s.moveWordTo);
  const deleteWord = useStudio((s) => s.deleteWord);
  const addWordAt = useStudio((s) => s.addWordAt);
  const insertAfterWord = useStudio((s) => s.insertAfterWord);
  const updateWordText = useStudio((s) => s.updateWordText);
  const snapEnabled = useStudio((s) => s.snapEnabled);
  const setSnapEnabled = useStudio((s) => s.setSnapEnabled);
  const zoom = useStudioLayout((s) => s.timelineZoom);
  const setZoom = useStudioLayout((s) => s.setTimelineZoom);
  const transcribing = useStudio((s) => s.transcribing);
  const { seek, timeRef } = usePlayback();

  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const drag = useRef<null | {
    id: string;
    kind: "start" | "end" | "move";
    originX: number;
    start: number;
    end: number;
  }>(null);
  const pending = useRef<null | { id: string; kind: "start" | "end" | "move"; start: number; end: number; dt: number }>(null);
  const dragRaf = useRef(0);
  const pxRef = useRef(1);
  const regionRef = useRef(region);
  regionRef.current = region;
  const resizeRef = useRef(resizeWordEdge);
  const moveRef = useRef(moveWordTo);
  resizeRef.current = resizeWordEdge;
  moveRef.current = moveWordTo;

  const visible = wordsInRegion(words, region);
  const span = Math.max(0.5, region.end - region.start);
  const pxPerSec = (width * zoom) / span;
  pxRef.current = pxPerSec;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 640));
    ro.observe(el);
    setWidth(el.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedWordId) return;
    const node = track.current?.querySelector(`[data-word="${selectedWordId}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedWordId]);

  const flushDrag = () => {
    dragRaf.current = 0;
    const p = pending.current;
    if (!p) return;
    if (p.kind === "move") moveRef.current(p.id, p.start + p.dt);
    else if (p.kind === "start") resizeRef.current(p.id, "start", p.start + p.dt);
    else resizeRef.current(p.id, "end", p.end + p.dt);
  };

  const startDrag = (id: string, kind: "start" | "end" | "move", e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const w = words.find((x) => x.id === id);
    if (!w) return;
    selectWord(id);
    seek(kind === "end" ? w.end : w.start);
    beginEdit(kind === "move" ? `move:${id}` : `edge:${id}:${kind}`);
    drag.current = { id, kind, originX: e.clientX, start: w.start, end: w.end };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      pending.current = { id: d.id, kind: d.kind, start: d.start, end: d.end, dt: (ev.clientX - d.originX) / pxRef.current };
      if (!dragRaf.current) dragRaf.current = requestAnimationFrame(flushDrag);
    };
    const up = () => {
      drag.current = null;
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current);
        dragRaf.current = 0;
        flushDrag();
      }
      pending.current = null;
      endEdit();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const energySlice = useMemo(
    () => downsampleEnergy(energyInRegion(analysis?.energy ?? [], analysis?.duration ?? 1, region), 64),
    [analysis?.energy, analysis?.duration, region],
  );

  const beats = useMemo(() => {
    const all = analysis?.beats ?? [];
    const inRange = all.filter((b) => b >= region.start && b <= region.end);
    if (inRange.length <= 36) return inRange;
    const step = Math.ceil(inRange.length / 36);
    return inRange.filter((_, i) => i % step === 0);
  }, [analysis?.beats, region]);

  useEffect(() => {
    let lastActive: HTMLElement | null = null;
    let lastT = -1;
    let lastHighlight = 0;
    return armLoop((now) => {
      const t = timeRef.current;
      const el = playhead.current;
      const r = regionRef.current;
      if (el) el.style.transform = `translate3d(${(t - r.start) * pxRef.current}px,0,0)`;
      if (now - lastHighlight > 80 && Math.abs(t - lastT) > 0.04) {
        lastT = t;
        lastHighlight = now;
        const root = track.current;
        if (root) {
          let next: HTMLElement | null = null;
          const nodes = root.querySelectorAll<HTMLElement>("[data-word]");
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const s = Number(n.dataset.start);
            const e = Number(n.dataset.end);
            if (t >= s && t < e) {
              next = n;
              break;
            }
          }
          if (next !== lastActive) {
            lastActive?.classList.remove("brightness-110");
            next?.classList.add("brightness-110");
            lastActive = next;
          }
        }
      }
    });
  }, [timeRef]);

  return (
    <div className="relative z-30 flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Word timeline</p>
        <span className="text-xs text-subtle">
          {transcribing ? "Hearing lyrics…" : "Double-click to edit. ⌘X removes the selected word. ⌘D duplicates it."}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={snapEnabled ? "primary" : "ghost"}
            aria-pressed={snapEnabled}
            data-snap={snapEnabled ? "on" : "off"}
            onClick={() => setSnapEnabled(!snapEnabled)}
          >
            <Magnet className="size-4" />
            {snapEnabled ? "Snap on" : "Snap off"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => addWordAt(timeRef.current)}>
            <Plus className="size-4" />
            Add word
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={(e) => {
              e.stopPropagation();
              setZoom(Math.max(1, Math.round((zoom - 0.5) * 10) / 10));
            }}
            disabled={zoom <= 1}
          >
            <Minus className="size-4" />
          </Button>
          <span className="w-12 text-center font-mono text-xs tabular-nums text-muted" data-zoom={zoom.toFixed(1)}>
            {zoom.toFixed(1)}x
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={(e) => {
              e.stopPropagation();
              setZoom(Math.min(6, Math.round((zoom + 0.5) * 10) / 10));
            }}
            disabled={zoom >= 6}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-x-scroll px-3 pt-11 pb-3 md:px-4">
        <div
          ref={track}
          className="relative h-28 touch-none select-none md:h-32"
          style={{ width: `${Math.max(width, span * pxPerSec)}px` }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-word], [data-bubble-menu]")) return;
            const el = track.current;
            if (!el) return;
            const x = e.clientX - el.getBoundingClientRect().left;
            seek(Math.max(region.start, Math.min(region.end, region.start + x / pxPerSec)));
          }}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-14 flex items-end gap-px">
            {energySlice.map((en, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm bg-muted"
                style={{ height: `${Math.max(6, en * 70)}%`, opacity: 0.2 + en * 0.45 }}
              />
            ))}
          </div>
          {beats.map((b) => (
            <div
              key={b}
              className="pointer-events-none absolute inset-y-0 w-px bg-border"
              style={{ left: (b - region.start) * pxPerSec }}
            />
          ))}
          {visible.map((word) => (
            <WordBubble
              key={word.id}
              word={word}
              left={(word.start - region.start) * pxPerSec}
              widthPx={Math.max(12, (word.end - word.start) * pxPerSec)}
              selected={word.id === selectedWordId}
              onSelect={() => selectWord(word.id)}
              onDrag={startDrag}
              onDelete={() => deleteWord(word.id)}
              onEdit={(text) => updateWordText(word.id, text)}
              onAdd={() => insertAfterWord(word.id, word.text)}
            />
          ))}
          <div ref={playhead} className="pointer-events-none absolute inset-y-0 left-0 z-20 w-px bg-playhead will-change-transform" />
        </div>
      </div>
    </div>
  );
}

const WordBubble = memo(function WordBubble({
  word,
  left,
  widthPx,
  selected,
  onSelect,
  onDrag,
  onDelete,
  onEdit,
  onAdd,
}: {
  word: LyricWord;
  left: number;
  widthPx: number;
  selected: boolean;
  onSelect: () => void;
  onDrag: (id: string, kind: "start" | "end" | "move", e: ReactPointerEvent) => void;
  onDelete: () => void;
  onEdit: (text: string) => void;
  onAdd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(word.text);
  const color = CHIP[Math.abs(word.line) % CHIP.length];

  useEffect(() => {
    setDraft(word.text);
  }, [word.text]);

  useEffect(() => {
    const onEditWord = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id !== word.id) return;
      setDraft(word.text);
      setEditing(true);
    };
    // legacy name, do not rename
    window.addEventListener("aftercut-edit-word", onEditWord);
    return () => window.removeEventListener("aftercut-edit-word", onEditWord);
  }, [word.id, word.text]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== word.text) onEdit(next);
    setEditing(false);
  };

  return (
    <div
      data-word={word.id}
      data-start={word.start}
      data-end={word.end}
      className={cn(
        "absolute top-8 flex h-9 items-center overflow-visible rounded-md text-lyric-fg",
        color,
        selected ? "z-20 ring-2 ring-accent" : "z-10 opacity-90",
        word.lowConfidence && "shadow-[inset_0_0_0_2px_#e23b3b]",
      )}
      style={{ left, width: widthPx }}
      title={`${word.text} · ${formatPrecise(word.start)}–${formatPrecise(word.end)}${typeof word.confidence === "number" ? ` · ${Math.round(word.confidence * 100)}%` : ""}${word.lowConfidence ? " · low confidence" : ""}`}
    >
      {selected && !editing ? (
        <div className="pointer-events-none absolute -top-6 left-1/2 z-30 flex -translate-x-1/2 gap-0.5">
          <button
            type="button"
            aria-label={`Remove ${word.text}`}
            title="Remove (⌘X)"
            className="pointer-events-auto flex size-5 items-center justify-center rounded bg-elevated text-muted shadow-[0_0_0_1px_rgba(242,239,232,0.12)] hover:text-fg"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDelete();
            }}
          >
            <X className="size-3" />
          </button>
          <button
            type="button"
            aria-label={`Duplicate ${word.text}`}
            title="Duplicate (⌘D)"
            className="pointer-events-auto flex size-5 items-center justify-center rounded bg-elevated text-muted shadow-[0_0_0_1px_rgba(242,239,232,0.12)] hover:text-fg"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onAdd();
            }}
          >
            <Plus className="size-3" />
          </button>
        </div>
      ) : null}
      {editing ? (
        <input
          value={draft}
          autoFocus
          aria-label="Edit word"
          className="absolute inset-0 z-20 rounded-md bg-bg px-1.5 text-xs font-semibold text-fg outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(word.text);
              setEditing(false);
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : null}
      <button
        type="button"
        aria-label={`Start of ${word.text}`}
        className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize rounded-l-md"
        onPointerDown={(e) => onDrag(word.id, "start", e)}
      />
      <button
        type="button"
        className="h-full min-w-0 flex-1 cursor-grab truncate px-1.5 text-left text-xs font-semibold"
        onPointerDown={(e) => {
          onSelect();
          onDrag(word.id, "move", e);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
          setDraft(word.text);
          setEditing(true);
        }}
      >
        {word.text}
      </button>
      <button
        type="button"
        aria-label={`End of ${word.text}`}
        className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize rounded-r-md"
        onPointerDown={(e) => onDrag(word.id, "end", e)}
      />
    </div>
  );
});

function energyInRegion(energy: number[], duration: number, region: { start: number; end: number }): number[] {
  if (!energy.length || duration <= 0) return [];
  const hop = duration / energy.length;
  const a = Math.max(0, Math.floor(region.start / hop));
  const b = Math.min(energy.length, Math.ceil(region.end / hop));
  const slice = energy.slice(a, Math.max(a + 8, b));
  return slice.length ? slice : energy;
}
