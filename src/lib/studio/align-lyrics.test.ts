import assert from "node:assert/strict";
import test from "node:test";
import { alignPastedLyrics, placeOnSpans } from "./align-lyrics.ts";

// Sung phrase on a beat, not speech. Times are the vocal's own onsets:
// short words, a held "running", then a breath before "through".
// They are not spaced evenly across the 8s snippet.
const heard = [
  { text: "I", startMs: 210, endMs: 280 },
  { text: "keep", startMs: 300, endMs: 520 },
  { text: "runnin", startMs: 540, endMs: 1180 },
  { text: "through", startMs: 2460, endMs: 2780 },
  { text: "the", startMs: 2800, endMs: 2920 },
  { text: "city", startMs: 2960, endMs: 3480 },
];

const paste = `verse one sits before the hook
I keep still running through the city
later the chorus comes back around
and we don't go home`;

test("sung line locks to vocal onsets instead of an even grid", () => {
  const result = alignPastedLyrics(paste, heard, 8000, 0);
  assert.deepEqual(
    result.words.map((word) => word.text),
    ["I", "keep", "still", "running", "through", "the", "city"],
  );
  assert.equal(result.draft, "I keep still running through the city");
  const byText = new Map(result.words.map((word) => [word.text, word]));
  assert.equal(byText.get("I")?.startMs, 210);
  assert.equal(byText.get("keep")?.endMs, 520);
  assert.equal(byText.get("running")?.startMs, 540);
  assert.equal(byText.get("running")?.endMs, 1180);
  assert.equal(byText.get("running")?.lowConfidence, true);
  assert.equal(byText.get("city")?.startMs, 2960);
  assert.equal(byText.get("city")?.endMs, 3480);
  assert.equal(byText.get("I")?.text, "I");
  const still = byText.get("still");
  assert.equal(still?.lowConfidence, true);
  assert.ok(still && still.startMs >= 520 && still.startMs < 540, `still landed at ${still?.startMs}, not in the gap after keep`);
  assert.ok(still && still.endMs <= 540, `still spilled into running (${still?.endMs})`);
  const even = result.words.map((_, i) => Math.round((i / result.words.length) * 8000));
  const actual = result.words.map((word) => word.startMs);
  assert.notDeepEqual(actual, even);
  assert.ok(actual[actual.length - 1]! < 4000, "the phrase should finish with the vocal, not the end of the snippet");
});

test("a miss still lands the pasted line on the vocal, not on an even grid", () => {
  const spans = [
    { text: "noise", startMs: 400, endMs: 900 },
    { text: "noise", startMs: 2800, endMs: 3600 },
  ];
  const result = placeOnSpans("I keep running through", spans, 0, 8000);
  assert.deepEqual(
    result.words.map((word) => word.text),
    ["I", "keep", "running", "through"],
  );
  assert.ok(result.words.every((word) => word.lowConfidence));
  assert.ok(result.words[0]!.startMs >= 400 && result.words[0]!.startMs < 900);
  assert.ok(result.words[result.words.length - 1]!.endMs <= 3600);
  assert.ok(result.words.every((word) => word.startMs < 4000));
});
