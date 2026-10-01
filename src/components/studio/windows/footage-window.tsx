import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronLeft, Film, ImagePlus, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhonePreview, Transport, useLivePreview } from "@/components/studio/studio-ui";
import { SplitPane } from "@/components/studio/split-pane";
import { useStudioLayout } from "@/lib/studio/layout";
import { PACKS, resolveCutClips } from "@/lib/studio/packs";
import { captureVideoPoster } from "@/lib/studio/media";
import { useStudio } from "@/lib/studio/store";
import type { MediaClip } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

function ingestUploads(files: File[]) {
  const { addUserClip, setUserClipPoster } = useStudio.getState();
  files.forEach((file) => {
    const src = URL.createObjectURL(file);
    const id = `up-${file.name}-${file.size}-${file.lastModified}`;
    const video = file.type.startsWith("video");
    addUserClip({
      id,
      kind: video ? "video" : "image",
      src,
      poster: video ? undefined : src,
      name: file.name.replace(/\.[^.]+$/, ""),
      origin: "upload",
    });
    if (video) {
      void captureVideoPoster(src).then((poster) => {
        if (poster) setUserClipPoster(id, poster);
      });
    }
  });
}

export function ClipShelf() {
  const packId = useStudio((s) => s.packId);
  const setCategory = useStudio((s) => s.setCategory);
  const footageTab = useStudio((s) => s.footageTab);
  const setFootageTab = useStudio((s) => s.setFootageTab);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const toggleCutClip = useStudio((s) => s.toggleCutClip);
  const removeUserClip = useStudio((s) => s.removeUserClip);
  const inputRef = useRef<HTMLInputElement>(null);
  const category = PACKS.find((p) => p.id === packId) ?? PACKS[0];

  const onFiles = (files: File[]) => {
    ingestUploads(files);
  };

  const clips = footageTab === "upload" ? userClips : category.clips;

  return (
    <div className="flex h-40 shrink-0 flex-col border-t border-border bg-bg">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 py-1.5">
        <Tab active={footageTab === "stock"} onClick={() => setFootageTab("stock")}>
          Stock
        </Tab>
        <Tab active={footageTab === "upload"} onClick={() => setFootageTab("upload")}>
          Yours{userClips.length ? ` · ${userClips.length}` : ""}
        </Tab>
        {footageTab === "stock"
          ? PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => setCategory(pack.id)}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-xs",
                  packId === pack.id ? "bg-fg text-bg" : "text-muted hover:text-fg",
                )}
              >
                {pack.name}
              </button>
            ))
          : null}
        <button
          type="button"
          className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:text-fg"
          onClick={() => inputRef.current?.click()}
        >
          Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="file-picker"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.currentTarget.value = "";
            if (files.length) onFiles(files);
          }}
        />
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 pb-2">
        {clips.length ? (
          clips.map((clip) => (
            <div key={clip.id} className="w-16 shrink-0">
              <ClipTile
                clip={clip}
                selected={selectedClipIds.includes(clip.id)}
                onToggle={() => toggleCutClip(clip.id)}
                onDelete={footageTab === "upload" ? () => removeUserClip(clip.id) : undefined}
              />
            </div>
          ))
        ) : (
          <p className="self-center text-sm text-muted">Upload a clip, or switch to stock.</p>
        )}
      </div>
    </div>
  );
}

export function FootageWindow() {
  const packId = useStudio((s) => s.packId);
  const setCategory = useStudio((s) => s.setCategory);
  const footageTab = useStudio((s) => s.footageTab);
  const setFootageTab = useStudio((s) => s.setFootageTab);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const userClips = useStudio((s) => s.userClips);
  const vaultClips = useStudio((s) => s.vaultClips);
  const vaultQuery = useStudio((s) => s.vaultQuery);
  const vaultBusy = useStudio((s) => s.vaultBusy);
  const vaultError = useStudio((s) => s.vaultError);
  const searchVault = useStudio((s) => s.searchVault);
  const toggleCutClip = useStudio((s) => s.toggleCutClip);
  const removeUserClip = useStudio((s) => s.removeUserClip);
  const removeFromCut = useStudio((s) => s.removeFromCut);
  const clearStock = useStudio((s) => s.clearStock);
  const addCategoryToCut = useStudio((s) => s.addCategoryToCut);
  const setStep = useStudio((s) => s.setStep);
  const mode = useStudio((s) => s.mode);
  const makeSingle = useStudio((s) => s.makeSingle);
  const previewW = useStudioLayout((s) => s.previewW);
  const setPreviewW = useStudioLayout((s) => s.setPreviewW);
  const cutH = useStudioLayout((s) => s.cutH);
  const setCutH = useStudioLayout((s) => s.setCutH);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(vaultQuery);
  const navigate = useNavigate();
  const recipe = useLivePreview();
  const category = PACKS.find((p) => p.id === packId) ?? PACKS[0];
  const extras = [...userClips, ...vaultClips];
  const cut = resolveCutClips(selectedClipIds, extras);
  const stockCount = cut.filter((c) => c.origin === "stock").length;
  const uploadCount = cut.filter((c) => c.origin === "upload").length;
  const searchKey = vaultQuery.trim().toLowerCase();
  const searchHits = searchKey ? vaultClips.filter((c) => c.categoryId === `search:${searchKey}`) : [];

  const onFiles = (files: File[]) => {
    ingestUploads(files);
  };

  const runSearch = () => {
    void searchVault(query);
  };

  return (
    <SplitPane axis="x" size={previewW} onChange={setPreviewW} min={160} max={560} className="h-full">
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
            onClick={() => {
              setStep("setup");
              void navigate({ href: "/studio/setup" });
            }}
          >
            <ChevronLeft className="size-4" />
            Setup
          </button>
          <h1 className="mt-2 text-lg font-semibold">Clips for the batch</h1>
          <p className="mt-1 text-sm text-muted">
            This pool is shared. Variations shuffle the order so the wall isn’t copies of one cut.
          </p>
          <div className="mt-3 flex gap-1">
            <Tab active={footageTab === "stock"} onClick={() => setFootageTab("stock")}>
              Stock library
            </Tab>
            <Tab active={footageTab === "upload"} onClick={() => setFootageTab("upload")}>
              Your clips{userClips.length ? ` · ${userClips.length}` : ""}
            </Tab>
          </div>
        </div>

        {footageTab === "stock" ? (
          <SplitPane axis="y" size={cutH} onChange={setCutH} min={120} max={420} className="min-h-0 flex-1">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <form
                className="shrink-0 px-4 pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch();
                }}
              >
                <label className="flex items-center gap-2 rounded-lg bg-elevated px-3 py-2 shadow-[0_0_0_1px_rgba(242,239,232,0.08)]">
                  <Search className="size-4 shrink-0 text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="NYC rain, Tokyo subway, empty diner…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
                  />
                  <Button type="submit" size="sm" variant="secondary" disabled={vaultBusy || query.trim().length < 2}>
                    {vaultBusy ? <LoaderCircle className="size-4 animate-spin" /> : "Search vault"}
                  </Button>
                </label>
                {vaultError ? <p className="mt-1 text-xs text-danger">{vaultError}</p> : null}
              </form>
              <div className="min-h-0 flex-1 overflow-y-scroll px-4 pb-4 pt-3">
                {searchHits.length ? (
                  <div className="mb-6">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Vault · {vaultQuery}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                      {searchHits.map((clip) => (
                        <ClipTile
                          key={clip.id}
                          clip={clip}
                          selected={selectedClipIds.includes(clip.id)}
                          onToggle={() => toggleCutClip(clip.id)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {PACKS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCategory(p.id)}
                      aria-label={`${p.name}, ${p.clips.length} clips`}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-sm",
                        packId === p.id ? "bg-fg text-bg" : "bg-elevated text-muted hover:text-fg",
                      )}
                    >
                      {p.name}
                      <span className="ml-1.5 text-xs opacity-70">{p.clips.length}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted">{category.description}</p>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => addCategoryToCut(category.id)}>
                    Add this category to the cut
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {category.clips.map((clip) => (
                    <ClipTile
                      key={clip.id}
                      clip={clip}
                      selected={selectedClipIds.includes(clip.id)}
                      onToggle={() => toggleCutClip(clip.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <CutTray
              cut={cut}
              stockCount={stockCount}
              uploadCount={uploadCount}
              onRemove={removeFromCut}
              onClearStock={clearStock}
              onNextLabel={mode === "single" ? "Build this video" : "Choose what gets varied"}
              onNext={() => {
                if (mode === "single") {
                  makeSingle();
                  setStep("edit");
                  void navigate({ href: "/studio/editor" });
                  return;
                }
                setStep("vary");
                void navigate({ href: "/studio/vary" });
              }}
            />
          </SplitPane>
        ) : (
          <SplitPane axis="y" size={cutH} onChange={setCutH} min={120} max={420} className="min-h-0 flex-1">
            <div className="h-full min-h-0 overflow-y-scroll p-4">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onFiles([...e.dataTransfer.files]);
                }}
                className="flex w-full flex-col items-center rounded-xl border border-dashed border-border px-4 py-10 text-center hover:bg-elevated"
              >
                <ImagePlus className="size-6 text-muted" />
                <p className="mt-3 text-sm text-fg">Drop your clips here</p>
                <p className="mt-1 text-xs text-subtle">MP4, MOV, JPG, PNG. They stay in Your clips until you remove them.</p>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  onFiles([...(e.target.files ?? [])]);
                  e.currentTarget.value = "";
                }}
              />
              {userClips.length ? (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {userClips.map((clip) => (
                    <ClipTile
                      key={clip.id}
                      clip={clip}
                      selected={selectedClipIds.includes(clip.id)}
                      onToggle={() => toggleCutClip(clip.id)}
                      onDelete={() => removeUserClip(clip.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-6 text-sm text-muted">Nothing uploaded yet. Stock and uploads never share a grid.</p>
              )}
            </div>
            <CutTray
              cut={cut}
              stockCount={stockCount}
              uploadCount={uploadCount}
              onRemove={removeFromCut}
              onClearStock={clearStock}
              onNextLabel={mode === "single" ? "Build this video" : "Choose what gets varied"}
              onNext={() => {
                if (mode === "single") {
                  makeSingle();
                  setStep("edit");
                  void navigate({ href: "/studio/editor" });
                  return;
                }
                setStep("vary");
                void navigate({ href: "/studio/vary" });
              }}
            />
          </SplitPane>
        )}
      </div>
      <aside className="flex h-full min-h-0 flex-col gap-2 overflow-y-scroll bg-surface p-3">
        <Transport compact />
        <div className="min-h-0 flex-1 overflow-hidden">
          <PhonePreview recipe={recipe} />
        </div>
      </aside>
    </SplitPane>
  );
}

function CutTray({
  cut,
  stockCount,
  uploadCount,
  onRemove,
  onClearStock,
  onNextLabel,
  onNext,
}: {
  cut: MediaClip[];
  stockCount: number;
  uploadCount: number;
  onRemove: (id: string) => void;
  onClearStock: () => void;
  onNextLabel: string;
  onNext: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface px-4 py-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">In this cut</p>
        <p className="text-xs text-muted">
          {cut.length} clip{cut.length === 1 ? "" : "s"} · {stockCount} stock · {uploadCount} yours
        </p>
        <Button type="button" size="sm" variant="ghost" disabled={!stockCount} onClick={onClearStock}>
          Clear stock
        </Button>
      </div>
      {cut.length ? (
        <div className="min-h-0 flex-1 overflow-y-scroll">
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
            {cut.map((clip) => (
              <div key={clip.id} className="relative">
                <img src={clip.poster ?? clip.src} alt="" className="aspect-[9/16] w-full rounded-md object-cover" />
                <span
                  className={cn(
                    "absolute left-1 top-1 rounded px-1 text-[9px] font-medium uppercase",
                    clip.origin === "upload" ? "bg-fg text-bg" : "bg-bg/80 text-fg",
                  )}
                >
                  {clip.origin === "upload" ? "Yours" : "Stock"}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${clip.name}`}
                  className="absolute right-1 top-1 rounded bg-bg/80 p-0.5 text-fg"
                  onClick={() => onRemove(clip.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">The cut is empty. Stock is cleared — add your clips, or pick stock again.</p>
      )}
      <Button type="button" className="mt-3 shrink-0" disabled={!cut.length} onClick={onNext}>
        {onNextLabel}
      </Button>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("h-8 rounded-md px-3 text-sm", active ? "bg-elevated text-fg" : "text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

function ClipTile({
  clip,
  selected,
  onToggle,
  onDelete,
}: {
  clip: MediaClip;
  selected: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const still = clip.poster ?? (clip.kind === "image" ? clip.src : "");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "block w-full overflow-hidden rounded-lg text-left",
          selected ? "shadow-[0_0_0_2px_rgba(236,231,220,0.9)]" : "shadow-[0_0_0_1px_rgba(242,239,232,0.08)]",
        )}
      >
        {still && !broken ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="aspect-[9/16] w-full bg-elevated object-cover"
          />
        ) : (
          <span className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1 bg-elevated px-1 text-center">
            <Film className="size-5 text-muted" />
            <span className="line-clamp-2 text-[10px] text-muted">{clip.name}</span>
          </span>
        )}
        <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{clip.name}</span>
      </button>
      {selected ? (
        <span className="absolute right-1 top-1 rounded-full bg-fg p-0.5 text-bg">
          <Check className="size-3" />
        </span>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          aria-label={`Delete ${clip.name}`}
          className="absolute left-1 top-1 rounded bg-bg/80 p-1 text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
