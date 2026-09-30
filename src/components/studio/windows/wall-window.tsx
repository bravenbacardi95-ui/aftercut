import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhonePreview, RecipeThumb, Transport, usePreviewRecipe } from "@/components/studio/studio-ui";
import { SplitPane } from "@/components/studio/split-pane";
import { useStudioLayout } from "@/lib/studio/layout";
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
  const exporting = useStudio((s) => s.exporting);
  const batchRows = useStudio((s) => s.batchRows);
  const batchNote = useStudio((s) => s.batchNote);
  const exportBatch = useStudio((s) => s.exportBatch);
  const cancelBatchExport = useStudio((s) => s.cancelBatchExport);
  const batching = exporting && batchRows.length > 0;
  const unique = uniqueRecipeCount(recipes);

  const open = (id: string) => {
    selectRecipe(id);
    void navigate({ href: "/studio/editor" });
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
            <Button type="button" onClick={() => void exportBatch()} disabled={exporting || !audioUrl}>
              {batching ? "Exporting batch…" : "Export batch"}
            </Button>
            {batching ? (
              <Button type="button" variant="secondary" onClick={() => cancelBatchExport()}>
                Cancel
              </Button>
            ) : null}
            {batching
              ? batchRows
                  .filter((row) => row.progress < 1)
                  .slice(-2)
                  .map((row) => (
                    <div key={row.id}>
                      <p className="truncate text-xs text-muted">{row.label}</p>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
                        <div className="h-full bg-accent" style={{ width: `${Math.round(row.progress * 100)}%` }} />
                      </div>
                    </div>
                  ))
              : null}
            {!exporting && batchNote ? <p className="text-xs text-muted">{batchNote}</p> : null}
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
