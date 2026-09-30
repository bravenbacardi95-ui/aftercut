import { getDecodedAudio } from "./audio-clip";
import type { LyricWord, Region } from "./types";

let active: AudioContext | null = null;

export function stopClicks() {
  const ctx = active;
  active = null;
  ctx?.close().catch(() => undefined);
}

export function playWordsWithClicks(words: LyricWord[], region: Region) {
  const audio = getDecodedAudio();
  if (!audio || !words.length) return Promise.resolve();
  stopClicks();
  const ctx = new AudioContext();
  active = ctx;
  const rate = audio.sampleRate;
  const i0 = Math.max(0, Math.floor(region.start * rate));
  const i1 = Math.min(audio.length, Math.ceil(region.end * rate));
  const length = Math.max(1, i1 - i0);
  const mix = new Float32Array(length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < length; i++) mix[i] += (data[i0 + i] ?? 0) / audio.numberOfChannels;
  }
  const buffer = ctx.createBuffer(1, length, rate);
  buffer.copyToChannel(mix, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const when = ctx.currentTime + 0.06;
  source.start(when);
  const done = new Promise<void>((resolve) => {
    source.onended = () => {
      if (active === ctx) active = null;
      ctx.close().catch(() => undefined);
      resolve();
    };
  });
  for (const word of words) {
    if (word.start < region.start - 0.05 || word.start > region.end + 0.05) continue;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1400;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const at = when + (word.start - region.start);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.025);
    osc.start(at);
    osc.stop(at + 0.03);
  }
  return done;
}
