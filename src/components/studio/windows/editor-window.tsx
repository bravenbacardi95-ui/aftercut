import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Download, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LyricEditor } from "@/components/studio/lyric-editor";
import { SplitPane } from "@/components/studio/split-pane";
import { Chip, ChipGroup, PhonePreview, Transport, useLivePreview } from "@/components/studio/studio-ui";
import { WordTimeline } from "@/components/studio/word-timeline";
import { FootageTimeline } from "@/components/studio/windows/footage-timeline";
import { ClipShelf } from "@/components/studio/windows/footage-window";
import { CAPTION_EFFECTS, CAPTION_FONTS, CAPTION_STYLES, FRAMINGS, LOOKS, resolveCutClips } from "@/lib/studio/packs";
import { downloadBlob, exportExtension, exportRecipe } from "@/lib/studio/export-video";
import { useStudioLayout } from "@/lib/studio/layout";
import { captionCaseLabel, captionPosLabel, captionSizeLabel, useStudio } from "@/lib/studio/store";
import type { CaptionCaseId, CaptionPosId, CaptionSizeId } from "@/lib/studio/types";

export function EditorWindow() {
  const recipes = useStudio((s) => s.recipes);
  const selectedId = useStudio((s) => s.selectedId);
  const selected = recipes.find((r) => r.id === selectedId) ?? recipes[0] ?? null;
  const preview = useLivePreview();
  const recipe = preview ?? selected;
  const updateSelected = useStudio((s) => s.updateSelected);
  const setStep = useStudio((s) => s.setStep);
  const mode = useStudio((s) => s.mode);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const lyrics = useStudio((s) => s.lyrics);
  const audioUrl = useStudio((s) => s.audioUrl);
  const region = useStudio((s) => s.region);
  const trackName = useStudio((s) => s.trackName);
  const captionPrefs = useStudio((s) => s.captionPrefs);
  const setCaptionPrefs = useStudio((s) => s.setCaptionPrefs);
  const timelineH = useStudioLayout((s) => s.timelineH);
  const previewW = useStudioLayout((s) => s.previewW);
  const inspectorW = useStudioLayout((s) => s.inspectorW);
  const setTimelineH = useStudioLayout((s) => s.setTimelineH);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);
  const setInspectorW = useStudioLayout((s) => s.setInspectorW);
  const navigate = useNavigate();
  useEffect(() => {
    if (mode !== "single") return;
    const state = useStudio.getState();
    if (!state.recipes.some((recipe) => recipe.id === "single") && state.clips().length) state.makeSingle();
  }, [mode]);
  const clips = useMemo(() => {
    const extras = [...userClips, ...vaultClips];
    const base = resolveCutClips(selectedClipIds, extras);
    const missing = (recipe?.clipIds ?? []).filter((id) => !base.some((c) => c.id === id));
    return missing.length ? [...base, ...resolveCutClips(missing, extras)] : base;
  }, [selectedClipIds, userClips, vaultClips, recipe]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const onExport = async () => {
    if (!audioUrl || !recipe) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const blob = await exportRecipe({
        recipe,
        clips,
        lyrics,
        audioUrl,
        start: region.start,
        end: region.end,
        captionPrefs,
        onProgress: setProgress,
      });
      const ext = exportExtension(blob);
      downloadBlob(blob, `${slug(trackName)}-${recipe.captionStyle}-${recipe.look}.${ext}`);
      setMessage(`Exported .${ext} — unlimited, no account.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const styleTarget = selected ?? recipe;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
          onClick={() => {
            if (mode === "single") {
              setStep("setup");
              void navigate({ href: "/studio/setup" });
              return;
            }
            setStep("wall");
            void navigate({ href: "/studio/wall" });
          }}
        >
          <ChevronLeft className="size-4" />
          {mode === "single" ? "Setup" : "Wall"}
        </button>
        <p className="text-sm text-muted">
          {mode === "single"
            ? "Choose clips above the timeline. Drag a clip to reorder it, or either edge to change its length."
            : selected
              ? `Version ${selected.index + 1}`
              : "Open a version from the wall"}
        </p>
      </div>
      <SplitPane axis="y" size={timelineH} onChange={setTimelineH} min={148} max={520} className="min-h-0 flex-1">
        <div className="h-full min-h-0">
          <div className="hidden h-full lg:block">
            <SplitPane axis="x" size={inspectorW} onChange={setInspectorW} min={200} max={480} className="h-full">
              <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={560} className="h-full">
                <aside className="h-full min-h-0 overflow-y-scroll p-3">
                  <LyricEditor />
                </aside>
                <section className="flex h-full min-h-0 flex-col items-stretch gap-2 overflow-hidden bg-surface p-3">
                  <Transport compact />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <PhonePreview recipe={preview} />
                  </div>
                </section>
              </SplitPane>
              <aside className="h-full overflow-y-scroll p-3">
                <StyleInspector
                  recipe={styleTarget}
                  captionPrefs={captionPrefs}
                  setCaptionPrefs={setCaptionPrefs}
                  busy={busy}
                  progress={progress}
                  message={message}
                  onExport={() => void onExport()}
                  onChange={(patch) => updateSelected(patch)}
                />
              </aside>
            </SplitPane>
          </div>
          <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 lg:hidden">
            <PhonePreview recipe={recipe} className="mx-auto h-[34vh] w-auto max-w-full" />
            <StyleInspector
              recipe={styleTarget}
              captionPrefs={captionPrefs}
              setCaptionPrefs={setCaptionPrefs}
              busy={busy}
              progress={progress}
              message={message}
              onExport={() => void onExport()}
              onChange={(patch) => updateSelected(patch)}
            />
            <LyricEditor />
          </div>
        </div>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <WordTimeline />
          </div>
          {mode === "single" ? <ClipShelf /> : null}
          <FootageTimeline />
        </div>
      </SplitPane>
    </div>
  );
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "aftercut";
}

function StyleInspector({
  recipe,
  captionPrefs,
  setCaptionPrefs,
  busy,
  progress,
  message,
  onExport,
  onChange,
}: {
  recipe: {
    font: string;
    captionStyle: string;
    effect: string;
    look: string;
    framing: string;
  } | null;
  captionPrefs: { size: CaptionSizeId; position: CaptionPosId; textCase: CaptionCaseId };
  setCaptionPrefs: (patch: Partial<{ size: CaptionSizeId; position: CaptionPosId; textCase: CaptionCaseId }>) => void;
  busy: boolean;
  progress: number;
  message: string | null;
  onExport: () => void;
  onChange: (patch: Partial<{ font: "brat" | "clean" | "editorial" | "poster"; captionStyle: "word" | "line" | "karaoke" | "typewriter"; effect: "none" | "outline" | "boxed"; look: "clean" | "film" | "crush" | "cool" | "fade"; framing: "fill" | "offset" | "letterbox" | "punch" }>) => void;
}) {
  const sizes: CaptionSizeId[] = ["s", "m", "l"];
  const positions: CaptionPosId[] = ["top", "mid", "low"];
  const cases: CaptionCaseId[] = ["as-is", "upper"];
  if (!recipe) return <p className="text-sm text-muted">Open a version from the wall to restyle it.</p>;
  return (
    <div className="flex flex-col gap-5">
      <Button type="button" onClick={onExport} disabled={busy || !recipe}>
        <Download className="size-4" />
        {busy ? `Exporting ${Math.round(progress * 100)}%` : "Export video"}
      </Button>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
      <ChipGroup label="Font">
        {CAPTION_FONTS.map((s) => (
          <Chip key={s.id} active={recipe.font === s.id} onClick={() => onChange({ font: s.id })}>
            {s.name}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Effect">
        {CAPTION_EFFECTS.map((s) => (
          <Chip key={s.id} active={recipe.effect === s.id} onClick={() => onChange({ effect: s.id })}>
            {s.name}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Animation">
        {CAPTION_STYLES.map((s) => (
          <Chip key={s.id} active={recipe.captionStyle === s.id} onClick={() => onChange({ captionStyle: s.id })}>
            {s.name}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Size">
        {sizes.map((id) => (
          <Chip key={id} active={captionPrefs.size === id} onClick={() => setCaptionPrefs({ size: id })}>
            {captionSizeLabel(id)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Position">
        {positions.map((id) => (
          <Chip key={id} active={captionPrefs.position === id} onClick={() => setCaptionPrefs({ position: id })}>
            {captionPosLabel(id)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Case">
        {cases.map((id) => (
          <Chip key={id} active={captionPrefs.textCase === id} onClick={() => setCaptionPrefs({ textCase: id })}>
            {captionCaseLabel(id)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Look">
        {LOOKS.map((s) => (
          <Chip key={s.id} active={recipe.look === s.id} onClick={() => onChange({ look: s.id })}>
            {s.name}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Framing">
        {FRAMINGS.map((s) => (
          <Chip key={s.id} active={recipe.framing === s.id} onClick={() => onChange({ framing: s.id })}>
            {s.name}
          </Chip>
        ))}
      </ChipGroup>
      <p className="flex items-center gap-2 text-xs text-subtle">
        <Film className="size-3.5" />
        Changes stay on this version. Export records in this browser.
      </p>
    </div>
  );
}
