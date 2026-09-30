const images = new Map<string, HTMLImageElement>();
const videos = new Map<string, HTMLVideoElement>();
let packVideosPlaying = false;
let mediaTick = 0;

export function mediaGeneration() {
  return mediaTick;
}

function bump() {
  mediaTick += 1;
}

function loadImage(src: string, cors: boolean) {
  const img = new Image();
  if (cors) img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.onload = () => bump();
  img.onerror = () => {
    if (cors) {
      const retry = loadImage(src, false);
      images.set(src, retry);
    }
    bump();
  };
  img.src = src;
  return img;
}

export function getImage(src: string): HTMLImageElement {
  let img = images.get(src);
  if (!img) {
    img = loadImage(src, !src.startsWith("/"));
    images.set(src, img);
  }
  return img;
}

export function getVideo(src: string): HTMLVideoElement {
  let el = videos.get(src);
  if (!el) {
    el = document.createElement("video");
    if (!src.startsWith("/")) el.crossOrigin = "anonymous";
    el.muted = true;
    el.defaultMuted = true;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.preload = "auto";
    el.autoplay = true;
    el.onloadeddata = () => bump();
    el.onerror = () => bump();
    el.src = src;
    videos.set(src, el);
    park(el);
  }
  return el;
}

function park(el: HTMLVideoElement) {
  if (typeof document === "undefined") return;
  let host = document.getElementById("aftercut-media");
  if (!host) {
    host = document.createElement("div");
    host.id = "aftercut-media";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:0;bottom:0;width:72px;height:128px;overflow:hidden;opacity:0.02;pointer-events:none;z-index:0";
    document.body.appendChild(host);
  }
  el.style.width = "72px";
  el.style.height = "128px";
  el.style.objectFit = "cover";
  host.appendChild(el);
}

function kick(el: HTMLVideoElement) {
  el.muted = true;
  el.defaultMuted = true;
  el.playbackRate = 1;
  if (!el.paused) return;
  const attempt = () => {
    void el.play().catch(() => undefined);
  };
  if (el.readyState >= 2) attempt();
  else el.addEventListener("canplay", attempt, { once: true });
  attempt();
}

let activeSrc: string | null = null;

export function setActiveVideo(src: string | null, playing: boolean) {
  if (activeSrc === src && packVideosPlaying === playing) {
    const current = src ? videos.get(src) : null;
    if (!playing || (current && !current.paused)) return;
  }
  activeSrc = src;
  packVideosPlaying = playing;
  for (const [key, el] of videos) {
    const shouldPlay = playing && key === src;
    if (shouldPlay) {
      if (el.paused) void el.play().catch(() => undefined);
    } else if (!el.paused) {
      el.pause();
    }
  }
}

export function playCutVideos(srcs: string[], active: string | null) {
  activeSrc = active;
  packVideosPlaying = srcs.length > 0;
  const keep = new Set(srcs.filter(Boolean));
  for (const src of keep) getVideo(src);
  for (const [src, el] of videos) {
    if (!keep.has(src)) {
      if (!el.paused) el.pause();
      continue;
    }
    el.preload = "auto";
    kick(el);
  }
}

export function setPackVideoPlaying(on: boolean) {
  if (!on) {
    playCutVideos([], null);
    return;
  }
  setActiveVideo(activeSrc, true);
}

export async function armExportClip(src: string | null, localTime: number) {
  if (!src) {
    activeSrc = null;
    packVideosPlaying = false;
    for (const el of videos.values()) {
      if (!el.paused) el.pause();
    }
    return;
  }
  const el = getVideo(src);
  const dur = Number.isFinite(el.duration) && el.duration > 0.25 ? el.duration : 0;
  const at = dur ? ((localTime % dur) + dur) % dur : Math.max(0, localTime);
  const same = activeSrc === src;
  activeSrc = src;
  packVideosPlaying = true;
  for (const [key, video] of videos) {
    if (key !== src && !video.paused) video.pause();
  }
  if (!same || !dur || wrappedDrift(el.currentTime, at, dur) > 0.5) {
    el.pause();
    await seekVideo(el, at);
  }
  if (el.paused) await el.play().catch(() => undefined);
}

export function awaitVideoFrame(el: HTMLVideoElement, timeout = 48) {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeout);
    const cb = el.requestVideoFrameCallback;
    if (!cb) return;
    cb.call(el, () => {
      window.clearTimeout(timer);
      finish();
    });
  });
}

function wrappedDrift(current: number, target: number, dur: number) {
  const drift = Math.abs(current - target);
  return Math.min(drift, Math.abs(dur - drift));
}

function seekVideo(el: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve) => {
    if (el.readyState >= 1 && Math.abs(el.currentTime - time) < 0.04) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("seeked", finish);
      resolve();
    };
    el.addEventListener("seeked", finish);
    try {
      el.currentTime = time;
    } catch {
      finish();
      return;
    }
    window.setTimeout(finish, 500);
  });
}

export function preloadPack(srcs: string[]) {
  for (const src of srcs) {
    if (src.endsWith(".mp4") || src.endsWith(".webm") || src.endsWith(".mov")) continue;
    getImage(src);
  }
}

export function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  zoom = 1,
  ox = 0,
  oy = 0,
) {
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh) * zoom;
  const w = sw * scale;
  const h = sh * scale;
  const x = dx + (dw - w) / 2 + ox;
  const y = dy + (dh - h) / 2 + oy;
  ctx.drawImage(source, x, y, w, h);
}
