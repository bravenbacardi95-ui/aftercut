import { memo, useEffect, useMemo, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { formatPrecise, formatTime } from "@/lib/studio/beats";
import { useStudio } from "@/lib/studio/store";
import { downsampleEnergy } from "@/lib/studio/waveform";
import type { Region } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { armLoop } from "@/lib/studio/yield";
import { usePlayback } from "./playback";

export function RegionScrubber() {
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const setRegion = useStudio((s) => s.setRegion);
  const beginEdit = useStudio((s) => s.beginEdit);
  const endEdit = useStudio((s) => s.endEdit);
  const { seek, playFrom, setScrubbing, timeRef } = usePlayback();
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const regionRef = useRef(region);
  regionRef.current = region;
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const playFromRef = useRef(playFrom);
  playFromRef.current = playFrom;
  const setRef = useRef(setRegion);
  setRef.current = setRegion;
  const setScrubbingRef = useRef(setScrubbing);
  setScrubbingRef.current = setScrubbing;

  if (!analysis) return null;
  const dur = analysis.duration || 1;

  const timeAt = (clientX: number) => {
    const el = track.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return x * dur;
  };

  const begin = (kind: "start" | "end" | "move" | "play", ev: ReactPointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const origin = timeAt(ev.clientX);
    const start = regionRef.current.start;
    const end = regionRef.current.end;
    const span = end - start;
    setScrubbingRef.current(kind === "play");
    if (kind !== "play") beginEdit("region");
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      /* pointer capture can fail in synthetic tests */
    }
    const move = (pev: PointerEvent) => {
      const t = timeAt(pev.clientX);
      if (kind === "play") {
        seekRef.current(Math.max(regionRef.current.start, Math.min(regionRef.current.end, t)), {
          bounds: regionRef.current,
        });
        return;
      }
      let next: Region = regionRef.current;
      if (kind === "start") next = { start: Math.min(t, end - 3), end };
      else if (kind === "end") next = { start, end: Math.max(t, start + 3) };
      else next = { start: start + (t - origin), end: start + (t - origin) + span };
      setRef.current(next);
    };
    const up = () => {
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setScrubbingRef.current(false);
      if (kind !== "play") endEdit();
      if (kind !== "play") {
        const r = regionRef.current;
        void playFromRef.current(r.start, r);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const left = (region.start / dur) * 100;
  const width = ((region.end - region.start) / dur) * 100;

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
        <span className="font-mono tabular-nums">
          {formatPrecise(region.start)} – {formatPrecise(region.end)}
        </span>
        <span className="tabular-nums">{formatTime(region.end - region.start)} clip</span>
      </div>
      <div
        ref={track}
        className="relative h-16 touch-none overflow-visible rounded-lg bg-elevated shadow-[0_0_0_1px_rgba(242,239,232,0.08)]"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-handle]")) return;
          const t = timeAt(e.clientX);
          if (t < region.start || t > region.end) {
            const span = region.end - region.start;
            const next = { start: t - span / 2, end: t + span / 2 };
            setRegion(next);
            void playFrom(next.start, next);
            return;
          }
          seek(t, { bounds: region });
          begin("play", e);
        }}
        role="slider"
        aria-label="Clip region"
        aria-valuemin={0}
        aria-valuemax={dur}
        aria-valuenow={region.start}
      >
        <WaveformBars energy={analysis.energy} />
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/55" style={{ width: `${left}%` }} />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-bg/55"
          style={{ width: `${Math.max(0, 100 - left - width)}%` }}
        />
        <div
          data-handle="move"
          className="absolute inset-y-0 cursor-grab bg-accent/20"
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            begin("move", e);
          }}
        />
        <div
          data-handle="start"
          role="slider"
          aria-label="Clip start"
          className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
          style={{ left: `${left}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            begin("start", e);
          }}
        >
          <span className="absolute inset-y-2 left-1/2 w-1 -translate-x-1/2 rounded-full bg-accent" />
        </div>
        <div
          data-handle="end"
          role="slider"
          aria-label="Clip end"
          className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
          style={{ left: `${left + width}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            begin("end", e);
          }}
        >
          <span className="absolute inset-y-2 left-1/2 w-1 -translate-x-1/2 rounded-full bg-accent" />
        </div>
        <PlayheadMark elRef={playhead} timeRef={timeRef} duration={dur} />
      </div>
      <SnippetScrubber />
      <p className="mt-2 text-xs text-subtle">
        Drag the window to choose a snippet — it plays from the start. Scrub the marker below for frame-accurate timing.
      </p>
    </div>
  );
}

function SnippetScrubber() {
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const { seek, playFrom, setScrubbing, timeRef } = usePlayback();
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let last = "";
    return armLoop(() => {
      const next = formatPrecise(timeRef.current);
      if (timeEl.current && next !== last) {
        timeEl.current.textContent = next;
        last = next;
      }
    });
  }, [timeRef]);

  if (!analysis) return null;
  const span = Math.max(0.5, region.end - region.start);
  const slice = energyInRegion(analysis.energy, analysis.duration, region);

  const timeAt = (clientX: number) => {
    const el = track.current;
    if (!el) return region.start;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return region.start + x * span;
  };

  const beginScrub = (ev: ReactPointerEvent) => {
    ev.preventDefault();
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    setScrubbing(true);
    const jump = (clientX: number) => {
      const t = timeAt(clientX);
      seek(t, { bounds: region });
    };
    jump(ev.clientX);
    const move = (pev: PointerEvent) => jump(pev.clientX);
    const up = (pev: PointerEvent) => {
      target.releasePointerCapture(pev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setScrubbing(false);
      void playFrom(timeAt(pev.clientX), region);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>Snippet marker</span>
        <span ref={timeEl} className="font-mono tabular-nums text-fg">
          {formatPrecise(region.start)}
        </span>
      </div>
      <div
        ref={track}
        className="relative h-14 touch-none overflow-visible rounded-lg bg-elevated shadow-[0_0_0_1px_rgba(242,239,232,0.08)]"
        onPointerDown={(e) => {
          beginScrub(e);
        }}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={region.start}
        aria-valuemax={region.end}
      >
        <div className="absolute inset-0 overflow-hidden rounded-lg">
          <WaveformBars energy={slice} />
        </div>
        <div ref={playhead} className="absolute inset-y-0 z-20 w-px bg-playhead will-change-transform">
          <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[1px] bg-playhead" />
        </div>
      </div>
      <PlayheadSync elRef={playhead} timeRef={timeRef} region={region} />
    </div>
  );
}

const WaveformBars = memo(function WaveformBars({ energy }: { energy: number[] }) {
  const bars = useMemo(() => downsampleEnergy(energy, 160), [energy]);
  return (
    <div className="flex h-full items-end gap-px px-1 py-1">
      {bars.map((en, i) => (
        <span
          key={i}
          className="flex-1 rounded-sm bg-muted"
          style={{ height: `${Math.max(8, en * 100)}%`, opacity: 0.28 + en * 0.72 }}
        />
      ))}
    </div>
  );
});

function PlayheadMark({
  elRef,
  timeRef,
  duration,
}: {
  elRef: RefObject<HTMLDivElement | null>;
  timeRef: MutableRefObject<number>;
  duration: number;
}) {
  const durRef = useRef(duration);
  durRef.current = duration;
  useEffect(() => {
    return armLoop(() => {
      const el = elRef.current;
      if (el) el.style.left = `${(timeRef.current / durRef.current) * 100}%`;
    });
  }, [elRef, timeRef]);
  return <div ref={elRef} className="pointer-events-none absolute inset-y-0 z-20 w-px bg-playhead" />;
}

function PlayheadSync({
  elRef,
  timeRef,
  region,
}: {
  elRef: RefObject<HTMLDivElement | null>;
  timeRef: MutableRefObject<number>;
  region: Region;
}) {
  const regionRef = useRef(region);
  regionRef.current = region;
  useEffect(() => {
    return armLoop(() => {
      const el = elRef.current;
      const r = regionRef.current;
      const span = Math.max(0.5, r.end - r.start);
      if (el) el.style.left = `${((timeRef.current - r.start) / span) * 100}%`;
    });
  }, [elRef, timeRef]);
  return null;
}

function energyInRegion(energy: number[], duration: number, region: Region): number[] {
  if (!energy.length || duration <= 0) return energy;
  const hop = duration / energy.length;
  const a = Math.max(0, Math.floor(region.start / hop));
  const b = Math.min(energy.length, Math.ceil(region.end / hop));
  const slice = energy.slice(a, Math.max(a + 8, b));
  return slice.length ? slice : energy;
}

export function RegionReadout({ className }: { className?: string }) {
  const region = useStudio((s) => s.region);
  return (
    <p className={cn("font-mono text-xs tabular-nums text-muted", className)}>
      {formatPrecise(region.start)} → {formatPrecise(region.end)}
    </p>
  );
}
