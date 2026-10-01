import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import { drawFrame, ensureCaptionFonts, frameShowsFootage } from "./compositor";
import { holdExportFrame, getImage, getVideo, setPackVideoPlaying } from "./media";
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
  try {
    const decoded = await decodeTrack(audioCtx, opts.audioUrl, opts.signal);
    throwIfAborted(opts.signal);
    const slice = sliceBuffer(audioCtx, decoded, opts.start, opts.end);
    const duration = Math.max(0.5, slice.duration);
    const frames = Math.max(1, Math.round(duration * fps));
    const showFootage = frameShowsFootage(opts.recipe, captionPrefs);
    const encoder = await openEncoder(width, height, fps, slice.numberOfChannels, slice.sampleRate);
    try {
      await encodePcm(encoder.audio, await matchRate(slice, encoder.sampleRate), opts.signal);
      for (let i = 0; i < frames; i++) {
        throwIfAborted(opts.signal);
        if (encoder.failed) throw encoder.failed;
        const t = opts.start + i / fps;
        if (showFootage) {
          const clip = clipForRecipe(opts.recipe, opts.clips, t);
          if (clip?.kind === "video") {
            const seg = segmentIndexAt(opts.recipe.cuts ?? [opts.start, opts.end], t);
            const local = Math.max(0, t - (opts.recipe.cuts?.[seg] ?? opts.start));
            await holdExportFrame(clip.src, local);
          } else {
            await holdExportFrame(null, 0);
          }
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
        const timestamp = Math.round((i * 1_000_000) / fps);
        const next = Math.round(((i + 1) * 1_000_000) / fps);
        while (encoder.video.encodeQueueSize > 8) {
          throwIfAborted(opts.signal);
          await waitDequeue(encoder.video, opts.signal);
        }
        const frame = new VideoFrame(canvas, { timestamp, duration: Math.max(1, next - timestamp) });
        try {
          encoder.noteVideo(timestamp);
          encoder.video.encode(frame, { keyFrame: i % fps === 0 });
        } finally {
          frame.close();
        }
        opts.onProgress?.(Math.min(1, (i + 1) / frames));
      }
      throwIfAborted(opts.signal);
      await encoder.video.flush();
      await encoder.audio.flush();
      if (encoder.failed) throw encoder.failed;
      return encoder.finish();
    } finally {
      if (encoder.video.state !== "closed") encoder.video.close();
      if (encoder.audio.state !== "closed") encoder.audio.close();
      await holdExportFrame(null, 0);
      setPackVideoPlaying(false);
    }
  } finally {
    await audioCtx.close().catch(() => undefined);
  }
}

type EncoderSession = {
  video: VideoEncoder;
  audio: AudioEncoder;
  sampleRate: number;
  failed: Error | null;
  noteVideo: (timestamp: number) => void;
  finish: () => Blob;
};

async function openEncoder(width: number, height: number, fps: number, channels: number, sampleRate: number): Promise<EncoderSession> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    throw new Error("Export needs WebCodecs in this browser.");
  }
  const videoRate = 6_000_000;
  const audioRate = 192_000;
  const mp4Video = await firstSupportedVideo(
    [
      { codec: "avc1.640028", avc: { format: "avc" } },
      { codec: "avc1.4d0028", avc: { format: "avc" } },
      { codec: "avc1.42001f", avc: { format: "avc" } },
    ],
    width,
    height,
    fps,
    videoRate,
  );
  const aac = mp4Video ? await audioSupported("mp4a.40.2", channels, sampleRate, audioRate) : false;
  if (mp4Video && aac) {
    return startSession({
      container: "mp4",
      width,
      height,
      fps,
      channels,
      sampleRate,
      video: mp4Video,
      audioCodec: "mp4a.40.2",
      videoBitrate: videoRate,
      audioBitrate: audioRate,
      muxVideo: "avc",
    });
  }

  const webmVideo = await firstSupportedVideo(
    [{ codec: "vp09.00.31.08" }, { codec: "vp09.00.10.08" }, { codec: "vp8" }],
    width,
    height,
    fps,
    videoRate,
  );
  let opusRate = sampleRate;
  let opus = webmVideo ? await audioSupported("opus", channels, sampleRate, audioRate) : false;
  if (webmVideo && !opus && sampleRate !== 48000) {
    opus = await audioSupported("opus", channels, 48000, audioRate);
    opusRate = 48000;
  }
  if (webmVideo && opus) {
    return startSession({
      container: "webm",
      width,
      height,
      fps,
      channels,
      sampleRate: opusRate,
      video: webmVideo,
      audioCodec: "opus",
      videoBitrate: videoRate,
      audioBitrate: audioRate,
      muxVideo: webmVideo.codec.startsWith("vp8") ? "V_VP8" : "V_VP9",
    });
  }
  throw new Error("Export needs an H.264, VP9, or VP8 encoder in this browser.");
}

async function firstSupportedVideo(
  candidates: Array<Pick<VideoEncoderConfig, "codec"> & Partial<VideoEncoderConfig>>,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
) {
  for (const latencyMode of ["realtime", undefined] as const) {
    for (const candidate of candidates) {
      const config: VideoEncoderConfig = {
        ...candidate,
        width,
        height,
        bitrate,
        framerate: fps,
        ...(latencyMode ? { latencyMode } : {}),
      };
      try {
        const supported = await VideoEncoder.isConfigSupported(config);
        if (supported.supported) return supported.config ?? config;
      } catch {
        /* try the next codec */
      }
    }
  }
  return null;
}

async function audioSupported(codec: string, channels: number, sampleRate: number, bitrate: number) {
  try {
    const supported = await AudioEncoder.isConfigSupported({ codec, numberOfChannels: channels, sampleRate, bitrate });
    return supported.supported === true;
  } catch {
    return false;
  }
}

function startSession(opts: {
  container: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  channels: number;
  sampleRate: number;
  video: VideoEncoderConfig;
  audioCodec: string;
  videoBitrate: number;
  audioBitrate: number;
  muxVideo: "avc" | "V_VP8" | "V_VP9";
}): EncoderSession {
  let failed: Error | null = null;
  const fail = (err: unknown) => {
    failed = err instanceof Error ? err : new Error("Export failed");
  };
  let audioOrigin: number | null = null;
  const videoTimes: number[] = [];
  let sink: ChunkSink = {
    addVideo: () => undefined,
    addAudio: () => undefined,
    finish: () => {
      throw new Error("Export failed");
    },
  };
  const addAudio = (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata | undefined) => {
    if (audioOrigin === null) audioOrigin = chunk.timestamp;
    sink.addAudio(chunk, meta, chunk.timestamp - audioOrigin);
  };
  const addVideo = (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined) => {
    const stamped = videoTimes.shift();
    sink.addVideo(chunk, meta, stamped ?? Math.max(0, chunk.timestamp));
  };

  const video = new VideoEncoder({
    output: (chunk, meta) => addVideo(chunk, meta),
    error: fail,
  });
  const audio = new AudioEncoder({
    output: (chunk, meta) => addAudio(chunk, meta),
    error: fail,
  });

  if (opts.container === "mp4") {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      fastStart: "in-memory",
      firstTimestampBehavior: "strict",
      video: { codec: "avc", width: opts.width, height: opts.height, frameRate: opts.fps },
      audio: { codec: "aac", numberOfChannels: opts.channels, sampleRate: opts.sampleRate },
    });
    sink = {
      addVideo: (chunk, meta, timestamp) => muxer.addVideoChunk(chunk, meta, timestamp),
      addAudio: (chunk, meta, timestamp) => muxer.addAudioChunk(chunk, meta, timestamp),
      finish: () => {
        muxer.finalize();
        return new Blob([target.buffer], { type: "video/mp4" });
      },
    };
  } else {
    const target = new WebmTarget();
    const muxer = new WebmMuxer({
      target,
      type: "webm",
      firstTimestampBehavior: "strict",
      video: { codec: opts.muxVideo, width: opts.width, height: opts.height, frameRate: opts.fps },
      audio: { codec: "A_OPUS", numberOfChannels: opts.channels, sampleRate: opts.sampleRate },
    });
    sink = {
      addVideo: (chunk, meta, timestamp) => muxer.addVideoChunk(chunk, meta, timestamp),
      addAudio: (chunk, meta, timestamp) => muxer.addAudioChunk(chunk, meta, timestamp),
      finish: () => {
        muxer.finalize();
        return new Blob([target.buffer], { type: "video/webm" });
      },
    };
  }

  video.configure({ ...opts.video, width: opts.width, height: opts.height, bitrate: opts.videoBitrate, framerate: opts.fps });
  audio.configure({
    codec: opts.audioCodec,
    numberOfChannels: opts.channels,
    sampleRate: opts.sampleRate,
    bitrate: opts.audioBitrate,
  });

  const session: EncoderSession = {
    video,
    audio,
    sampleRate: opts.sampleRate,
    get failed() {
      return failed;
    },
    noteVideo: (timestamp) => {
      videoTimes.push(timestamp);
    },
    finish: () => sink.finish(),
  };
  return session;
}

type ChunkSink = {
  addVideo: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined, timestamp: number) => void;
  addAudio: (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata | undefined, timestamp: number) => void;
  finish: () => Blob;
};

function matchRate(buffer: AudioBuffer, sampleRate: number) {
  if (buffer.sampleRate === sampleRate) return Promise.resolve(buffer);
  const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

async function encodePcm(encoder: AudioEncoder, buffer: AudioBuffer, signal?: AbortSignal) {
  const channels = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const piece = 1024;
  for (let offset = 0; offset < buffer.length; offset += piece) {
    throwIfAborted(signal);
    while (encoder.encodeQueueSize > 16) {
      throwIfAborted(signal);
      await waitDequeue(encoder, signal);
    }
    const count = Math.min(piece, buffer.length - offset);
    const data = new Float32Array(count * channels);
    for (let c = 0; c < channels; c++) data.set(buffer.getChannelData(c).subarray(offset, offset + count), c * count);
    const audio = new AudioData({
      format: "f32-planar",
      sampleRate: sr,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset * 1_000_000) / sr),
      data,
    });
    encoder.encode(audio);
    audio.close();
  }
}

function waitDequeue(encoder: VideoEncoder | AudioEncoder, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      encoder.removeEventListener("dequeue", finish);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      encoder.removeEventListener("dequeue", finish);
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    encoder.addEventListener("dequeue", finish, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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