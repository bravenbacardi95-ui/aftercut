import { Children, useCallback, useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SplitPane({
  axis,
  size,
  onChange,
  min = 140,
  max = 640,
  endSize = true,
  className,
  children,
}: {
  axis: "x" | "y";
  size: number;
  onChange: (px: number) => void;
  min?: number;
  max?: number;
  endSize?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const panes = Children.toArray(children);

  const move = useCallback(
    (client: number) => {
      const el = root.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const total = axis === "x" ? box.width : box.height;
      const origin = axis === "x" ? box.left : box.top;
      const pos = client - origin;
      const next = endSize ? total - pos : pos;
      onChange(Math.min(max, Math.max(min, next)));
    },
    [axis, endSize, max, min, onChange],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    move(axis === "x" ? e.clientX : e.clientY);
  };

  const endDrag = () => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const startStyle = endSize ? { flex: "1 1 0%" } : { flex: `0 0 ${size}px` };
  const endStyle = endSize ? { flex: `0 0 ${size}px` } : { flex: "1 1 0%" };

  return (
    <div
      ref={root}
      className={cn("flex min-h-0 min-w-0 overflow-hidden", axis === "x" ? "flex-row" : "flex-col", className)}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" style={startStyle}>
        {panes[0]}
      </div>
      <div
        role="separator"
        aria-orientation={axis === "x" ? "vertical" : "horizontal"}
        aria-label={axis === "x" ? "Resize panels" : "Resize panels"}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 32 : 12;
          if (axis === "x" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            const dir = e.key === "ArrowLeft" ? 1 : -1;
            onChange(size + (endSize ? dir : -dir) * step);
          }
          if (axis === "y" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            const dir = e.key === "ArrowUp" ? 1 : -1;
            onChange(size + (endSize ? dir : -dir) * step);
          }
        }}
        className={cn(
          "group relative z-20 shrink-0 bg-border hover:bg-fg",
          axis === "x" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
        )}
      >
        <span
          className={cn(
            "absolute bg-transparent",
            axis === "x" ? "inset-y-0 -left-2 -right-2 cursor-col-resize" : "inset-x-0 -top-2 -bottom-2 cursor-row-resize",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute rounded-full bg-muted group-hover:bg-bg",
            axis === "x" ? "left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2" : "left-1/2 top-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2",
          )}
        />
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" style={endStyle}>
        {panes[1]}
      </div>
    </div>
  );
}
