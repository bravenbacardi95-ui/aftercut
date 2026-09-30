"""Tests for the one-pass MMS_FA aligner.

The known-clip test synthesizes nothing. It aligns scripts/testdata/known-phrase.wav,
five spoken words with silence between them. Ground truth is each word's energy onset
in that file, not an onset the aligner snapped to.
"""

from __future__ import annotations

import json
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np
import torch
import torchaudio

import align_lyrics

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "testdata" / "known-phrase.json"
WAV = ROOT / "testdata" / "known-phrase.wav"


class AlignLyricsTest(unittest.TestCase):
    def test_removed_line_window_helpers(self) -> None:
        self.assertFalse(hasattr(align_lyrics, "SHORT_WORDS"))
        self.assertFalse(hasattr(align_lyrics, "vocal_activity"))
        self.assertFalse(hasattr(align_lyrics, "split_regions"))
        self.assertFalse(hasattr(align_lyrics, "group_regions"))

    def test_lines_come_from_the_paste(self) -> None:
        words = align_lyrics.parse_words("hello from\nthe other side")
        self.assertEqual(
            [(word["text"], word["line"]) for word in words],
            [("hello", 0), ("from", 0), ("the", 1), ("other", 1), ("side", 1)],
        )

    def test_resample_is_torchaudio(self) -> None:
        called = {}
        real = torchaudio.functional.resample

        def wrapped(wav, from_rate, to_rate, *args, **kwargs):
            called["yes"] = True
            return real(wav, from_rate, to_rate, *args, **kwargs)

        torchaudio.functional.resample = wrapped
        try:
            out = align_lyrics.resample(np.zeros(4410, dtype=np.float32), 44100, 16000)
        finally:
            torchaudio.functional.resample = real
        self.assertTrue(called.get("yes"))
        self.assertEqual(out.ndim, 1)
        self.assertAlmostEqual(out.size, 1600, delta=8)

    def test_snap_moves_at_most_40ms_either_way(self) -> None:
        later = [{"rawStartMs": 1000, "startMs": 1000, "endMs": 1300}]
        align_lyrics.apply_snap(later, [1035])
        self.assertEqual(later[0]["startMs"], 1035)
        earlier = [{"rawStartMs": 1000, "startMs": 1000, "endMs": 1300}]
        align_lyrics.apply_snap(earlier, [970])
        self.assertEqual(earlier[0]["startMs"], 970)
        far = [{"rawStartMs": 1000, "startMs": 1000, "endMs": 1300}]
        align_lyrics.apply_snap(far, [1041])
        self.assertEqual(far[0]["startMs"], 1000)
        earlier_far = [{"rawStartMs": 1000, "startMs": 1000, "endMs": 1300}]
        align_lyrics.apply_snap(earlier_far, [959])
        self.assertEqual(earlier_far[0]["startMs"], 1000)

    def test_snap_does_not_cross_the_next_word(self) -> None:
        words = [
            {"rawStartMs": 1000, "startMs": 1000, "endMs": 1100},
            {"rawStartMs": 1030, "startMs": 1030, "endMs": 1200},
        ]
        align_lyrics.apply_snap(words, [1020])
        self.assertEqual(words[0]["startMs"], 1020)
        self.assertEqual(words[1]["startMs"], 1030)

    def test_long_audio_splits_on_silence_with_overlap(self) -> None:
        rate = 16000
        samples = np.full(rate * 70, 0.2, np.float32)
        samples[rate * 40 : int(rate * 41.5)] = 0
        silences = align_lyrics.long_silences(samples, rate)
        self.assertTrue(silences, "expected the inserted gap to be a silence")
        chunks = align_lyrics.plan_chunks(70.0, silences)
        self.assertEqual(len(chunks), 2)
        cut = chunks[0]["keep_end"]
        self.assertGreater(cut, 40.0)
        self.assertLess(cut, 42.0)
        self.assertLess(chunks[1]["audio_start"], cut)
        self.assertGreater(chunks[0]["audio_end"], cut)
        self.assertAlmostEqual(chunks[0]["audio_end"] - cut, 2.0, delta=0.05)
        self.assertAlmostEqual(cut - chunks[1]["audio_start"], 2.0, delta=0.05)
        self.assertEqual(len(align_lyrics.plan_chunks(12.0, [])), 1)

    def test_over_60s_realigns_across_the_cut(self) -> None:
        truth = {"one": 10000.0, "two": 20000.0, "three": 39000.0, "four": 42000.0, "five": 50000.0, "six": 60000.0}
        calls: list[float] = []

        def fake_forward(samples):
            return torch.zeros(4, 29)

        def fake_align(emission, n_samples, rate, words, origin_ms):
            calls.append(float(origin_ms))
            placed = []
            for word in words:
                start = truth[word["text"]]
                placed.append(
                    {
                        "text": word["text"],
                        "line": word["line"],
                        "rawStartMs": start,
                        "rawEndMs": start + 200,
                        "startMs": start,
                        "endMs": start + 200,
                        "confidence": 0.8,
                    }
                )
            return placed

        rate = 16000
        samples = np.full(rate * 70, 0.2, np.float32)
        samples[rate * 40 : int(rate * 41.5)] = 0
        pcm = (samples * 32767).astype(np.int16)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "long.wav"
            with wave.open(str(path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(rate)
                handle.writeframes(pcm.tobytes())
            original_forward = align_lyrics.forward
            original_align = align_lyrics.align_emission
            align_lyrics.forward = fake_forward
            align_lyrics.align_emission = fake_align
            try:
                result = align_lyrics.align_wav(str(path), "one two three four\nfive six", True, False)
            finally:
                align_lyrics.forward = original_forward
                align_lyrics.align_emission = original_align
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["feed"]["method"], "wav2vec2-ctc-silence-chunks")
        self.assertEqual([word["text"] for word in result["words"]], ["one", "two", "three", "four", "five", "six"])
        self.assertEqual([word["line"] for word in result["words"]], [0, 0, 0, 0, 1, 1])
        for word in result["words"]:
            self.assertEqual(word["startMs"], truth[word["text"]])
        boundary = [origin for origin in calls if origin > 30000]
        self.assertGreaterEqual(len(boundary), 2, f"boundary was not re-aligned: {calls}")

    def test_known_clip_word_starts(self) -> None:
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        result = align_lyrics.align_wav(str(WAV), fixture["text"], True, False)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["feed"]["method"], "wav2vec2-ctc-one-pass")
        self.assertEqual(result["feed"]["sampleRate"], 16000)
        self.assertIsNone(result["feed"]["resampledFrom"])
        self.assertFalse(result["feed"]["snap"])
        words = result["words"]
        self.assertEqual([word["text"] for word in words], [item["text"] for item in fixture["words"]])
        self.assertEqual([word["line"] for word in words], [item["line"] for item in fixture["words"]])
        errors = []
        print("\nknown clip (snap off, one pass)")
        for word, truth in zip(words, fixture["words"]):
            error = float(word["startMs"]) - float(truth["startMs"])
            errors.append(error)
            self.assertEqual(word["startMs"], word["rawStartMs"])
            print(
                f"  {word['text']}\ttruth={truth['startMs']}\traw={word['rawStartMs']}\t"
                f"conf={word['confidence']}\terr={error:+.1f}ms"
            )
        mean = sum(abs(error) for error in errors) / len(errors)
        worst = max(abs(error) for error in errors)
        print(f"  mean={mean:.1f}ms worst={worst:.1f}ms")
        self.assertLess(mean, 40, f"mean error {mean:.1f}ms")
        self.assertLess(worst, 80, f"worst error {worst:.1f}ms")


if __name__ == "__main__":
    unittest.main()
