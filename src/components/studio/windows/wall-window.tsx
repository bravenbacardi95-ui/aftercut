import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PhonePreview, RecipeThumb, Transport, usePreviewRecipe } from "@/components/studio/studio-ui";
import { SplitPane } from "@/components/studio/split-pane";
import { useStudioLayout } from "@/lib/studio/layout";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";

export function WallWindow() {
  const recipes = useStudio((s) => s.recipes.filter((recipe) => recipe.id !== "single"));
  const selectedId = useStudio((s) => s.selectedId);
  const selectRecipe = useStudio((s) => s.selectRecipe);
  const setStep = useStudio((s) => s.setStep);
  const navigate = useNavigate();
  const recipe = usePreviewRecipe();
  const previewW = useStudioLayout((s) => s.previewW);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);

  const open = (id: string) => {
    selectRecipe(id);
    void navigate({ to: "/studio/editor" });
  };

  return (
    <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={420} className="h-full">
      <section className="h-full min-h-0 overflow-y-scroll p-4">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
          onClick={() => {
            setStep("vary");
            void navigate({ to: "/studio/vary" });
          }}
        >
          <ChevronLeft className="size-4" />
          Variations
        </button>
        <div className="mt-4">
          <h1 className="text-lg font-medium">Keep the ones that land</h1>
          <p className="mt-1 text-sm text-muted">
            {recipes.length
              ? `${recipes.length} versions from this batch. Open one to change its footage order, clip lengths, and lyrics. The others stay as they were.`
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
        {selectedId ? (
          <button
            type="button"
            className="text-sm text-muted hover:text-fg"
            onClick={() => void navigate({ to: "/studio/editor" })}
          >
            Open lyrics and footage →
          </button>
        ) : null}
      </aside>
    </SplitPane>
  );
}
