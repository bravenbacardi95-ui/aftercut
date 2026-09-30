import assert from "node:assert/strict";
import test from "node:test";
import { setDecodedAudio } from "./audio-clip";
import type { LyricWord } from "./types";
import { atomsFromEnvelope, layoutOnAtoms, lockWordsToSinging } from "./vocal-activity";

function word(text: string, start: number, end: number): LyricWord {
  return { id: text, text, start, end, line: 0 };
}

test("singing bursts become atoms and drum clicks do not", () => {
  const env = new Float32Array(200).fill(0.02);
  for (let i = 20; i < 70; i++) env[i] = 0.8;
  for (let i = 40; i < 48; i++) env[i] = 0.05;
  for (let i = 90; i < 93; i++) env[i] = 1;
  for (let i = 120; i < 170; i++) env[i] = 0.9;
  for (let i = 145; i < 152; i++) env[i] = 0.04;

  const atoms = atomsFromEnvelope(env, 0.01, 0);
  assert.ok(atoms.length >= 3, `expected syllable atoms, got ${atoms.length}`);
  for (const atom of atoms) {
    assert.ok(atom.start < 0.75 || atom.start > 1.05, `atom landed in the instrumental gap: ${atom.start}`);
    assert.ok(!(atom.start > 0.88 && atom.start < 0.98), "click was treated as singing");
  }
});

test("words with useless timestamps lock onto the sung phrases", () => {
  const atoms = [
    { start: 0.2, end: 0.42 },
    { start: 0.48, end: 0.7 },
    { start: 1.3, end: 1.55 },
    { start: 1.62, end: 1.9 },
  ];
  const words = ["all", "that", "little", "rappin"].map((text) => word(text, 0.01, 0.08));
  const placed = layoutOnAtoms(words, atoms, { start: 0, end: 2.2 });
  assert.equal(placed.length, 4);
  for (let i = 1; i < placed.length; i++) assert.ok(placed[i]!.start >= placed[i - 1]!.end - 0.02);
  assert.ok(placed[0]!.start < 0.8);
  assert.ok(placed[2]!.start > 1.1);
  assert.ok(placed.every((item) => item.end - item.start > 0.08));
  const gap = placed.filter((item) => item.start >= 0.75 && item.start < 1.15);
  assert.equal(gap.length, 0);
});

test("a sung tone is detected and a bass click is ignored", () => {
  const sr = 16000;
  const duration = 2;
  const data = new Float32Array(sr * duration);
  const tone = (start: number, end: number, freq: number) => {
    for (let i = Math.floor(start * sr); i < Math.floor(end * sr); i++) {
      data[i] = (data[i] ?? 0) + 0.45 * Math.sin((2 * Math.PI * freq * i) / sr);
    }
  };
  tone(0.25, 0.7, 740);
  tone(1.25, 1.75, 620);
  const clickAt = Math.floor(0.95 * sr);
  for (let k = 0; k < 70; k++) {
    data[clickAt + k] = 0.9 * Math.sin((2 * Math.PI * 90 * k) / sr) * (1 - k / 70);
  }
  setDecodedAudio({
    sampleRate: sr,
    duration,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer);

  const placed = lockWordsToSinging(
    [word("hey", 0, 0.05), word("love", 0.05, 0.1)],
    { start: 0, end: 2 },
  );
  assert.equal(placed.length, 2);
  assert.ok(placed[0]!.start < 0.85, `first word ${placed[0]!.start}`);
  assert.ok(placed[1]!.start > 1.05, `second word ${placed[1]!.start}`);
  assert.ok(placed[0]!.end < 1.05);
  assert.ok(placed[1]!.end > 1.5);
});
