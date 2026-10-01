import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, ChipGroup, PhonePreview, Transport, useLivePreview } from "@/components/studio/studio-ui";
import { SplitPane } from "@/components/studio/split-pane";
import { BATCH_SIZES, CAPTION_EFFECTS, CAPTION_FONTS, CAPTION_STYLES, FRAMINGS, LOOKS, PACINGS } from "@/lib/studio/packs";
import { buildRecipes, uniqueRecipeCount } from "@/lib/studio/recipes";
import { useStudioLayout } from "@/lib/studio/layout";
import { useStudio } from "@/lib/studio/store";
import { cn } from "@/lib/utils";

export function VaryWindow() {
  const captionStyles = useStudio((s) => s.captionStyles);
  const captionEffects = useStudio((s) => s.captionEffects);
  const fonts = useStudio((s) => s.fonts);
  const looks = useStudio((s) => s.looks);
  const framings = useStudio((s) => s.framings);
  const pacing = useStudio((s) => s.pacing);
  const batchSize = useStudio((s) => s.batchSize);
  const toggleStyle = useStudio((s) => s.toggleStyle);
  const toggleEffect = useStudio((s) => s.toggleEffect);
  const toggleFont = useStudio((s) => s.toggleFont);
  const toggleLook = useStudio((s) => s.toggleLook);
  const toggleFraming = useStudio((s) => s.toggleFraming);
  const setPacing = useStudio((s) => s.setPacing);
  const setBatchSize = useStudio((s) => s.setBatchSize);
  const analysis = useStudio((s) => s.analysis);
  const region = useStudio((s) => s.region);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const generate = useStudio((s) => s.generate);
  const generating = useStudio((s) => s.generating);
  const captionPrefs = useStudio((s) => s.captionPrefs);
  const setCaptionPrefs = useStudio((s) => s.setCaptionPrefs);
  const setStep = useStudio((s) => s.setStep);
  const navigate = useNavigate();
  const recipe = useLivePreview();
  const previewW = useStudioLayout((s) => s.previewW);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);

  const build = () => {
    generate();
    void navigate({ href: "/studio/wall" });
  };
  const unique = useMemo(() => {
    if (!analysis) return 0;
    return uniqueRecipeCount(
      buildRecipes({
        count: batchSize,
        styles: captionStyles,
        fonts,
        effects: captionEffects,
        looks,
        framings,
        pacing,
        clipIds: selectedClipIds.length ? selectedClipIds : ["clip"],
        region,
        analysis,
      }),
    );
  }, [analysis, batchSize, captionEffects, captionStyles, fonts, framings, looks, pacing, region, selectedClipIds]);

  return (
    <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={560} className="h-full">
      <aside className="h-full min-h-0 min-w-0 overflow-y-scroll border-r border-border p-4">
        <div className="flex max-w-xl flex-col gap-6">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
            onClick={() => {
              setStep("footage");
              void navigate({ href: "/studio/footage" });
            }}
          >
            <ChevronLeft className="size-4" />
            Footage
          </button>
          <div>
            <h1 className="text-lg font-semibold">Batch variations</h1>
            <p className="mt-1 text-sm text-muted">
              Each version keeps your lyrics and snippet, then changes type, look, framing, and clip order. One video mode is the path when you want a single cut you control.
            </p>
          </div>
          <ChipGroup label="Font">
            {CAPTION_FONTS.map((s) => (
              <Chip key={s.id} active={fonts.includes(s.id)} onClick={() => toggleFont(s.id)}>
                {s.name}
              </Chip>
            ))}
          </ChipGroup>
          <p className="text-xs text-subtle">
            Fonts add and remove. This batch will be {unique} unique
            {unique === batchSize ? "" : ` of ${batchSize}`}. Plate color, full or block, position, and rows change on each one.
          </p>
          <ChipGroup label="Effect">
            {CAPTION_EFFECTS.map((s) => (
              <Chip key={s.id} active={captionEffects.includes(s.id)} onClick={() => toggleEffect(s.id)}>
                {s.name}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label="Animation">
            {CAPTION_STYLES.map((s) => (
              <Chip key={s.id} active={captionStyles.includes(s.id)} onClick={() => toggleStyle(s.id)}>
                {s.name}
              </Chip>
            ))}
          </ChipGroup>
          {captionStyles.includes("brat") ? (
            <>
              <ChipGroup label="Brat plate">
                <Chip active={(captionPrefs.bratPlateMode ?? "full") === "full"} onClick={() => setCaptionPrefs({ bratPlateMode: "full" })}>
                  Full
                </Chip>
                <Chip active={captionPrefs.bratPlateMode === "block"} onClick={() => setCaptionPrefs({ bratPlateMode: "block" })}>
                  Block
                </Chip>
                {(
                  [
                    ["white", "White"],
                    ["green", "Green"],
                    ["black", "Black"],
                  ] as const
                ).map(([id, label]) => (
                  <Chip key={id} active={captionPrefs.bratPlate === id} onClick={() => setCaptionPrefs({ bratPlate: id })}>
                    {label}
                  </Chip>
                ))}
              </ChipGroup>
              <ChipGroup label="Brat footage">
                <Chip active={!captionPrefs.bratFootage} onClick={() => setCaptionPrefs({ bratFootage: false })}>
                  Off
                </Chip>
                <Chip active={captionPrefs.bratFootage} onClick={() => setCaptionPrefs({ bratFootage: true })}>
                  On
                </Chip>
              </ChipGroup>
              <ChipGroup label="Brat fade">
                <Chip active={!captionPrefs.bratFade} onClick={() => setCaptionPrefs({ bratFade: false })}>
                  Off
                </Chip>
                <Chip active={captionPrefs.bratFade} onClick={() => setCaptionPrefs({ bratFade: true })}>
                  80ms
                </Chip>
              </ChipGroup>
            </>
          ) : null}
          <ChipGroup label="Looks">
            {LOOKS.map((s) => (
              <Chip key={s.id} active={looks.includes(s.id)} onClick={() => toggleLook(s.id)}>
                {s.name}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label="Framings">
            {FRAMINGS.map((s) => (
              <Chip key={s.id} active={framings.includes(s.id)} onClick={() => toggleFraming(s.id)}>
                {s.name}
              </Chip>
            ))}
          </ChipGroup>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Pacing</p>
            <div className="mt-2 grid gap-2">
              {PACINGS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPacing(p.id)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-left text-sm shadow-[0_0_0_1px_rgba(242,239,232,0.08)]",
                    pacing === p.id ? "bg-elevated shadow-[0_0_0_1px_rgba(236,231,220,0.7)]" : "bg-surface",
                  )}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">{p.blurb}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Batch size</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {BATCH_SIZES.map((n) => (
                <Chip key={n} active={batchSize === n} onClick={() => setBatchSize(n)}>
                  {n}
                </Chip>
              ))}
            </div>
          </div>
          <Button type="button" onClick={build} disabled={generating}>
            {generating ? "Cutting the wall…" : `Build ${batchSize} videos`}
          </Button>
        </div>
      </aside>
      <section className="flex h-full min-h-0 flex-col gap-2 overflow-hidden bg-surface p-3">
        <Transport compact />
        <div className="min-h-0 flex-1 overflow-hidden">
          <PhonePreview recipe={recipe} />
        </div>
      </section>
    </SplitPane>
  );
}
