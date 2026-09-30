import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhonePreview, RecipeThumb, Transport, usePreviewRecipe } from "@/components/studio/studio-ui";
import { SplitPane } from "@/components/studio/split-pane";
import { downloadZip, exportRecipeBatch, type BatchExportRow } from "@/lib/studio/export-batch";
import { useStudioLayout } from "@/lib/studio/layout";
import { resolveCutClips } from "@/lib/studio/packs";
import { uniqueRecipeCount } from "@/lib/studio/recipes";
import { useStudio } from "@/lib/studio/store";
import type { Recipe } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

let wallSource: Recipe[] | null = null;
let wallCached: Recipe[] = [];

function selectWallRecipes(state: { recipes: Recipe[] }): Recipe[] {
  if (state.recipes === wallSource) return wallCached;
  wallSource = state.recipes;
  wallCached = state.recipes.filter((recipe) => recipe.id !== "single");
  return wallCached;
}

export function WallWindow() {
  const recipes = useStudio(selectWallRecipes);
  const selectedId = useStudio((s) => s.selectedId);
  const selectRecipe = useStudio((s) => s.selectRecipe);
  const setStep = useStudio((s) => s.setStep);
  const navigate = useNavigate();
  const recipe = usePreviewRecipe();
  const previewW = useStudioLayout((s) => s.previewW);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);
  const audioUrl = useStudio((s) => s.audioUrl);
  const lyrics = useStudio((s) => s.lyrics);
  const region = useStudio((s) => s.region);
  const captionPrefs = useStudio((s) => s.captionPrefs);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const trackName = useStudio((s) => s.trackName);
  const generating = useStudio((s) => s.generating);
  const [rows, setRows] = useState<BatchExportRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  const unique = uniqueRecipeCount(recipes);

  const open = (id: string) => {
    selectRecipe(id);
    void navigate({ href: "/studio/editor" });
  };

  const clipsFor = (target: Recipe) => {
    const extras = [...userClips, ...vaultClips];
    const ids = [...new Set([...(target.clipIds ?? []), ...selectedClipIds])];
    return resolveCutClips(ids, extras);
  };

  const exportBatch = async () => {
    if (!audioUrl || !recipes.length || generating) return;
    const controller = new AbortController();
    cancelRef.current = controller;
    setRows(recipes.map((item) => ({ id: item.id, label: `${item.index + 1}`, progress: 0 })));
    setNote(null);
    useStudio.setState({ generating: true });
    try {
      const blob = await exportRecipeBatch({
        recipes,
        clipsFor,
        lyrics,
        audioUrl,
        start: region.start,
        end: region.end,
        captionPrefs,
        signal: controller.signal,
        onItem: (row) => {
          setRows((prev) => {
            const next = prev.filter((item) => item.id !== row.id);
            next.push(row);
            return next;
          });
        },
      });
      downloadZip(blob, `${slug(trackName)}-batch.zip`);
      setNote(`Downloaded ${recipes.length} videos.`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") setNote("Export cancelled.");
      else setNote(err instanceof Error ? err.message : "Export failed");
    } finally {
      cancelRef.current = null;
      useStudio.setState({ generating: false });
    }
  };

  return (
    <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={420} className="h-full">
      <section className="h-full min-h-0 overflow-y-scroll p-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
          onClick={() => {
            setStep("vary");
            void navigate({ href: "/studio/vary" });
          }}
        >
          <ChevronLeft className="size-4" />
          Variations
        </button>
        <div className="mt-4">
          <h1 className="text-lg font-medium">Keep the ones that land</h1>
          <p className="mt-1 text-sm text-muted">
            {recipes.length
              ? `${recipes.length} versions · ${unique} unique across font, style, look, framing, cuts, and clip order. Open one to change that version only.`
              : "Build a batch from Variations first. One video mode is separate — it won’t fill this wall."}
          </p>
        </div>
        {recipes.length ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => open(r.id)}
                className={cn(
                  "overflow-hidden rounded-md",
                  selectedId === r.id ? "shadow-[0_0_0_1px_rgba(236,231,220,0.8)]" : "shadow-[0_0_0_1px_rgba(242,239,232,0.08)]",
                )}
              >
                <RecipeThumb recipe={r} />
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <aside className="flex h-full min-h-0 flex-col gap-2 overflow-y-scroll bg-surface p-3">
        <Transport compact />
        <div className="w-full shrink-0">
          <PhonePreview recipe={recipe} />
        </div>
        {recipes.length ? (
          <div className="flex flex-col gap-2">
            <Button type="button" onClick={() => void exportBatch()} disabled={generating || !audioUrl}>
              {generating ? "Exporting batch…" : "Export batch"}
            </Button>
            {generating ? (
              <Button type="button" variant="secondary" onClick={() => cancelRef.current?.abort()}>
                Cancel
              </Button>
            ) : null}
            {rows
              .filter((row) => row.progress < 1)
              .slice(-2)
              .map((row) => (
                <div key={row.id}>
                  <p className="truncate text-xs text-muted">{row.label}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
                    <div className="h-full bg-accent" style={{ width: `${Math.round(row.progress * 100)}%` }} />
                  </div>
                </div>
              ))}
            {note ? <p className="text-xs text-muted">{note}</p> : null}
          </div>
        ) : null}
        {selectedId ? (
          <button
            type="button"
            className="text-sm text-muted hover:text-fg"
            onClick={() => void navigate({ href: "/studio/editor" })}
          >
            Open lyrics and footage →
          </button>
        ) : null}
      </aside>
    </SplitPane>
  );
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "aftercut";
}
