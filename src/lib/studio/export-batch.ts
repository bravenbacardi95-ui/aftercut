import { zipSync } from "fflate";
import { downloadBlob, exportExtension, exportRecipe } from "./export-video";
import type { CaptionPrefs, LyricLine, MediaClip, Recipe } from "./types";

export type BatchExportRow = {
  id: string;
  label: string;
  progress: number;
};

export async function exportRecipeBatch(opts: {
  recipes: Recipe[];
  clipsFor: (recipe: Recipe) => MediaClip[];
  lyrics: LyricLine[];
  audioUrl: string;
  start: number;
  end: number;
  captionPrefs?: CaptionPrefs;
  signal: AbortSignal;
  onItem: (row: BatchExportRow) => void;
}): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  for (const recipe of opts.recipes) {
    if (opts.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    const label = `${recipe.index + 1}. ${recipe.font} · ${recipe.captionStyle} · ${recipe.look}`;
    opts.onItem({ id: recipe.id, label, progress: 0 });
    const blob = await exportRecipe({
      recipe,
      clips: opts.clipsFor(recipe),
      lyrics: opts.lyrics,
      audioUrl: opts.audioUrl,
      start: opts.start,
      end: opts.end,
      captionPrefs: opts.captionPrefs,
      signal: opts.signal,
      onProgress: (progress) => opts.onItem({ id: recipe.id, label, progress }),
    });
    const ext = exportExtension(blob);
    const name = `${String(recipe.index + 1).padStart(2, "0")}-${recipe.font}-${recipe.captionStyle}-${recipe.look}-${recipe.framing}.${ext}`;
    files[name] = new Uint8Array(await blob.arrayBuffer());
    opts.onItem({ id: recipe.id, label, progress: 1 });
  }
  if (opts.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  if (!Object.keys(files).length) throw new Error("Nothing exported.");
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped], { type: "application/zip" });
}

export function downloadZip(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}
