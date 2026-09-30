import { create } from "zustand";

type Layout = {
  timelineH: number;
  previewW: number;
  inspectorW: number;
  cutH: number;
  timelineZoom: number;
  setTimelineH: (n: number) => void;
  setPreviewW: (n: number) => void;
  setInspectorW: (n: number) => void;
  setCutH: (n: number) => void;
  setTimelineZoom: (n: number) => void;
};

const KEY = "aftercut-layout";

function load(): Pick<Layout, "timelineH" | "previewW" | "inspectorW" | "cutH"> {
  const fallback = { timelineH: 268, previewW: 220, inspectorW: 300, cutH: 196 };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      timelineH: clamp(Number(parsed.timelineH), 148, 560, fallback.timelineH),
      previewW: clamp(Number(parsed.previewW), 148, 640, fallback.previewW),
      inspectorW: clamp(Number(parsed.inspectorW), 200, 480, fallback.inspectorW),
      cutH: clamp(Number(parsed.cutH), 120, 420, fallback.cutH),
    };
  } catch {
    return fallback;
  }
}

function persist(state: Pick<Layout, "timelineH" | "previewW" | "inspectorW" | "cutH">) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function clamp(n: number, min: number, max: number, fallback: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export const useStudioLayout = create<Layout>((set, get) => ({
  ...load(),
  timelineZoom: 2,
  setTimelineH: (timelineH) => {
    const next = { ...get(), timelineH: clamp(timelineH, 148, 560, 268) };
    persist(next);
    set({ timelineH: next.timelineH });
  },
  setPreviewW: (previewW) => {
    const next = { ...get(), previewW: clamp(previewW, 148, 640, 220) };
    persist(next);
    set({ previewW: next.previewW });
  },
  setInspectorW: (inspectorW) => {
    const next = { ...get(), inspectorW: clamp(inspectorW, 200, 480, 300) };
    persist(next);
    set({ inspectorW: next.inspectorW });
  },
  setCutH: (cutH) => {
    const next = { ...get(), cutH: clamp(cutH, 120, 420, 196) };
    persist(next);
    set({ cutH: next.cutH });
  },
  setTimelineZoom: (timelineZoom) => set({ timelineZoom: clamp(timelineZoom, 1, 6, 2) }),
}));
