import { Zip, ZipPassThrough } from "fflate";
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
  const parts: BlobPart[] = [];
  let failed: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      failed = err instanceof Error ? err : new Error("Could not build the zip");
      return;
    }
    if (data?.byteLength) parts.push(data);
  });
  let added = 0;
  try {
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
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
      added += 1;
      if (failed) throw failed;
      opts.onItem({ id: recipe.id, label, progress: 1 });
    }
    if (opts.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    if (!added) throw new Error("Nothing exported.");
    zip.end();
    if (failed) throw failed;
    return new Blob(parts, { type: "application/zip" });
  } catch (err) {
    zip.terminate();
    throw err;
  }
}

export function downloadZip(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}