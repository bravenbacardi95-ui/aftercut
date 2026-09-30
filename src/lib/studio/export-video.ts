import { drawFrame, ensureCaptionFonts } from "./compositor";
import { armExportClip, awaitVideoFrame, getImage, getVideo, setPackVideoPlaying } from "./media";
import { clipForRecipe, segmentIndexAt } from "./recipes";
import { DEFAULT_CAPTION_PREFS, type CaptionPrefs, type LyricLine, type MediaClip, type Recipe } from "./types";

export async function exportRecipe(opts: {
  recipe: Recipe;
  clips: MediaClip[];
  lyrics: LyricLine[];
  audioUrl: string;
  start: number;
  end: number;
  captionPrefs?: CaptionPrefs;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}): Promise<Blob> {
  const width = 720;
  const height = 1280;
  const fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ensureCaptionFonts();
  const captionPrefs = opts.captionPrefs ?? DEFAULT_CAPTION_PREFS;
  throwIfAborted(opts.signal);
  await waitForClips(opts.clips, opts.signal);
  throwIfAborted(opts.signal);
  setPackVideoPlaying(false);

  const audioCtx = new AudioContext();
  const decoded = await decodeTrack(audioCtx, opts.audioUrl, opts.signal);
  throwIfAborted(opts.signal);
  const slice = sliceBuffer(audioCtx, decoded, opts.start, opts.end);
  const dest = audioCtx.createMediaStreamDestination();
  const bufferSource = audioCtx.createBufferSource();
  bufferSource.buffer = slice;
  bufferSource.connect(dest);

  const duration = Math.max(0.5, slice.duration);
  const frames = Math.max(1, Math.round(duration * fps));
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const combined = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

  const mime = pickMime();
  const recorder = new MediaRecorder(combined, {
    mimeType: mime,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  try {
    await Promise.race([
      audioCtx.resume().catch(() => undefined),
      whenAborted(opts.signal),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]);
    throwIfAborted(opts.signal);
    await new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Export failed"));
      recorder.start(200);
      bufferSource.start();
      const started = performance.now();
      let lastSrc: string | null = null;
      void (async () => {
        try {
          for (let i = 0; i < frames; i++) {
            if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
            const t = opts.start + i / fps;
            const clip = clipForRecipe(opts.recipe, opts.clips, t);
            const src = clip?.kind === "video" ? clip.src : null;
            if (src !== lastSrc) {
              if (src) {
                const seg = segmentIndexAt(opts.recipe.cuts ?? [opts.start, opts.end], t);
                const local = Math.max(0, t - (opts.recipe.cuts?.[seg] ?? opts.start));
                await armExportClip(src, local);
                await awaitVideoFrame(getVideo(src), 80);
              } else {
                await armExportClip(null, 0);
              }
              lastSrc = src;
            } else if (src) {
              const video = getVideo(src);
              if (video.paused) void video.play().catch(() => undefined);
            }
            drawFrame(ctx, {
              recipe: opts.recipe,
              clips: opts.clips,
              lyrics: opts.lyrics,
              time: t,
              width,
              height,
              captionPrefs,
              quality: "export",
            });
            videoTrack.requestFrame?.();
            opts.onProgress?.(Math.min(1, (i + 1) / frames));
            const target = started + ((i + 1) * 1000) / fps;
            const wait = target - performance.now();
            if (wait > 0) await sleep(wait);
          }
          bufferSource.stop();
          await sleep(120);
          if (recorder.state !== "inactive") recorder.stop();
        } catch (err) {
          try {
            bufferSource.stop();
          } catch {
            /* already stopped */
          }
          if (recorder.state === "recording") {
            recorder.onstop = null;
            recorder.stop();
          }
          reject(err instanceof Error ? err : new Error("Export failed"));
        }
      })();
    });
  } finally {
    videoTrack.stop();
    for (const track of stream.getTracks()) track.stop();
    for (const track of combined.getTracks()) track.stop();
    for (const track of dest.stream.getTracks()) track.stop();
    await armExportClip(null, 0);
    setPackVideoPlaying(false);
    await audioCtx.close().catch(() => undefined);
  }

  if (!chunks.length) throw new Error("Export produced an empty file.");
  return new Blob(chunks, { type: mime });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

function whenAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const fail = () => reject(new DOMException("Export cancelled", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function decodeTrack(ctx: AudioContext, url: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const res = await Promise.race([fetch(url), whenAborted(signal)]);
  if (!res.ok) throw new Error("Could not load audio for export");
  throwIfAborted(signal);
  const raw = await res.arrayBuffer();
  throwIfAborted(signal);
  return await Promise.race([ctx.decodeAudioData(raw.slice(0)), whenAborted(signal)]);
}

function sliceBuffer(ctx: AudioContext, source: AudioBuffer, start: number, end: number) {
  const sr = source.sampleRate;
  const a0 = Math.max(0, Math.floor(start * sr));
  const a1 = Math.min(source.length, Math.max(a0 + 1, Math.ceil(end * sr)));
  const slice = ctx.createBuffer(source.numberOfChannels, a1 - a0, sr);
  for (let c = 0; c < source.numberOfChannels; c++) {
    slice.getChannelData(c).set(source.getChannelData(c).subarray(a0, a1));
  }
  return slice;
}

function waitForClips(clips: MediaClip[], signal?: AbortSignal) {
  return Promise.all(
    clips.map(
      (clip) =>
        new Promise<void>((resolve, reject) => {
          const done = () => resolve();
          const fail = () => reject(new DOMException("Export cancelled", "AbortError"));
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail, { once: true });
          if (clip.kind === "video") {
            const video = getVideo(clip.src);
            if (video.readyState >= 2) {
              done();
              return;
            }
            video.addEventListener("loadeddata", done, { once: true });
            video.addEventListener("error", done, { once: true });
            window.setTimeout(done, 4000);
            return;
          }
          const img = getImage(clip.poster || clip.src);
          if (img.complete && img.naturalWidth) {
            done();
            return;
          }
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          window.setTimeout(done, 4000);
        }),
    ),
  );
}

function pickMime(): string {
  const types = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportExtension(blob: Blob): "mp4" | "webm" {
  return blob.type.includes("mp4") ? "mp4" : "webm";
}
