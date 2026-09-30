"""wav2vec2 CTC forced alignment (torchaudio MMS_FA) for one vocal stem.

Every word in the snippet is aligned in one pass over the whole stem.
Line breaks come from the pasted text after that pass. Snapping to onsets
is off unless the job asks for it. Times are relative to the wav that was passed in.
"""

from __future__ import annotations

import json
import re
import sys
import wave

import numpy as np
import torch
import torchaudio
from torchaudio.pipelines import MMS_FA

SAMPLE_RATE = 16000
LETTERS = set("abcdefghijklmnopqrstuvwxyz'")
MAX_CHUNK_S = 60.0
OVERLAP_S = 2.0
MIN_SILENCE_S = 0.4
SNAP_MS = 40.0
ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen",
]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

_MODEL = None
_TOKENIZER = None
_ALIGNER = None


def spell(number: int) -> str:
    if number < 0:
        return "minus " + spell(-number)
    if number < 20:
        return ONES[number]
    if number < 100:
        ten, rest = divmod(number, 10)
        return TENS[ten] if rest == 0 else f"{TENS[ten]} {ONES[rest]}"
    if number < 1000:
        hundred, rest = divmod(number, 100)
        head = f"{ONES[hundred]} hundred"
        return head if rest == 0 else f"{head} {spell(rest)}"
    return " ".join(ONES[int(digit)] for digit in str(number))


def normalize_pieces(raw: str) -> list[str]:
    text = raw.lower().replace("’", "'").replace("‘", "'")
    text = re.sub(r"\d+", lambda match: " " + spell(int(match.group(0))) + " ", text)
    text = re.sub(r"[^a-z'\s]", " ", text)
    pieces = []
    for part in text.split():
        cleaned = "".join(ch for ch in part if ch in LETTERS)
        if cleaned:
            pieces.append(cleaned)
    return pieces


def parse_words(text: str) -> list[dict]:
    words = []
    line_index = 0
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        raw_words = raw_line.split()
        if not raw_words:
            continue
        for raw in raw_words:
            words.append({"text": raw, "line": line_index, "pieces": normalize_pieces(raw)})
        line_index += 1
    return words


def read_wav(path: str) -> tuple[np.ndarray, int, int]:
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise RuntimeError(f"expected 16-bit wav, got {width * 8}-bit")
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    else:
        data = data.reshape(-1)
    return np.ascontiguousarray(data), rate, channels


def resample(mono: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    if from_rate == to_rate or mono.size == 0:
        return np.ascontiguousarray(mono, dtype=np.float32)
    wav = torch.from_numpy(np.ascontiguousarray(mono, dtype=np.float32)).unsqueeze(0)
    out = torchaudio.functional.resample(wav, from_rate, to_rate)
    return np.ascontiguousarray(out.squeeze(0).detach().cpu().numpy(), dtype=np.float32)


def load_models():
    global _MODEL, _TOKENIZER, _ALIGNER
    if _MODEL is None:
        _MODEL = MMS_FA.get_model()
        _MODEL.eval()
        _TOKENIZER = MMS_FA.get_tokenizer()
        _ALIGNER = MMS_FA.get_aligner()
    return _MODEL, _TOKENIZER, _ALIGNER


def long_silences(samples: np.ndarray, rate: int, min_s: float = MIN_SILENCE_S) -> list[tuple[float, float]]:
    hop = max(1, int(rate * 0.01))
    win = max(hop, int(rate * 0.02))
    if samples.size < win:
        return []
    count = 1 + (samples.size - win) // hop
    rms = np.empty(count, dtype=np.float32)
    for index in range(count):
        frame = samples[index * hop : index * hop + win]
        rms[index] = float(np.sqrt(np.mean(frame * frame) + 1e-12))
    loud = float(np.percentile(rms, 80))
    thresh = max(1e-4, loud * 0.25)
    min_frames = max(1, int(round(min_s * rate / hop)))
    regions: list[tuple[float, float]] = []
    start = None
    for index, level in enumerate(rms):
        if level <= thresh:
            if start is None:
                start = index
        elif start is not None:
            if index - start >= min_frames:
                regions.append((start * hop / rate, index * hop / rate))
            start = None
    if start is not None and count - start >= min_frames:
        regions.append((start * hop / rate, count * hop / rate))
    return regions


def plan_chunks(duration: float, silences: list[tuple[float, float]]) -> list[dict]:
    if duration <= MAX_CHUNK_S:
        return _bounds_to_chunks([0.0, duration])
    cuts: list[float] = []
    cursor = 0.0
    for _ in range(32):
        if duration - cursor <= MAX_CHUNK_S:
            break
        window_lo = cursor + 15.0
        window_hi = cursor + MAX_CHUNK_S
        best_mid = None
        best_len = -1.0
        for start, end in silences:
            length = end - start
            if length < MIN_SILENCE_S:
                continue
            mid = (start + end) / 2
            if window_lo <= mid <= window_hi and length > best_len:
                best_len = length
                best_mid = mid
        cut = best_mid if best_mid is not None else min(cursor + MAX_CHUNK_S, duration - 1.0)
        if cut <= cursor + 1.0:
            break
        cuts.append(float(cut))
        cursor = float(cut)
    return _bounds_to_chunks([0.0, *cuts, duration])


def _bounds_to_chunks(bounds: list[float]) -> list[dict]:
    duration = bounds[-1]
    last = len(bounds) - 2
    chunks = []
    for index in range(last + 1):
        keep_start = bounds[index]
        keep_end = bounds[index + 1]
        audio_start = 0.0 if index == 0 else max(0.0, keep_start - OVERLAP_S)
        audio_end = duration if index == last else min(duration, keep_end + OVERLAP_S)
        chunks.append(
            {
                "audio_start": audio_start,
                "audio_end": audio_end,
                "keep_start": keep_start,
                "keep_end": keep_end,
            }
        )
    return chunks


def stem_onsets(samples: np.ndarray, rate: int) -> list[float]:
    hop = 160
    win = 400
    if samples.size < win or rate <= 0:
        return []
    window = np.hanning(win).astype(np.float32)
    count = 1 + (samples.size - win) // hop
    flux = np.empty(count, dtype=np.float32)
    previous = None
    for index in range(count):
        frame = samples[index * hop : index * hop + win] * window
        spec = np.abs(np.fft.rfft(frame))
        if previous is None:
            flux[index] = 0.0
        else:
            flux[index] = float(np.mean(np.maximum(0.0, spec - previous)))
        previous = spec
    peak = float(np.percentile(flux, 90)) or 1e-6
    onsets: list[float] = []
    for index in range(1, count - 1):
        if flux[index] >= flux[index - 1] and flux[index] >= flux[index + 1] and flux[index] > peak * 0.45:
            at = index * hop / rate * 1000
            if not onsets or at - onsets[-1] >= 30:
                onsets.append(at)
    return onsets


def apply_snap(words: list[dict], onsets: list[float]) -> None:
    for index, word in enumerate(words):
        raw = float(word["rawStartMs"])
        lo = float(words[index - 1]["startMs"]) if index else float("-inf")
        hi = float(words[index + 1]["rawStartMs"]) if index + 1 < len(words) else float("inf")
        candidates = [onset for onset in onsets if abs(onset - raw) <= SNAP_MS and lo < onset < hi]
        chosen = raw if not candidates else min(candidates, key=lambda onset: abs(onset - raw))
        word["startMs"] = round(float(chosen), 1)
        if float(word["endMs"]) < word["startMs"] + 20:
            word["endMs"] = round(word["startMs"] + 30, 1)


def trim_overlaps(words: list[dict]) -> None:
    for index in range(1, len(words)):
        prev = words[index - 1]
        word = words[index]
        if word["startMs"] < prev["endMs"]:
            prev["endMs"] = round(max(prev["startMs"] + 20, word["startMs"]), 1)
        if word["endMs"] < word["startMs"] + 20:
            word["endMs"] = round(word["startMs"] + 30, 1)


def forward(samples: np.ndarray) -> torch.Tensor:
    model, _tokenizer, _aligner = load_models()
    waveform = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32)).unsqueeze(0)
    with torch.inference_mode():
        emission, _ = model(waveform)
    return emission[0]


def align_emission(
    emission: torch.Tensor,
    n_samples: int,
    rate: int,
    words: list[dict],
    origin_ms: float,
) -> list[dict] | None:
    if not words:
        return []
    dictionary = MMS_FA.get_dict()
    _model, _tokenizer, aligner = load_models()
    pieces: list[str] = []
    owners: list[int] = []
    for index, word in enumerate(words):
        for piece in word["pieces"]:
            pieces.append(piece)
            owners.append(index)
    if not pieces:
        return [_blank_word(word, origin_ms) for word in words]

    tokens: list[list[int]] = []
    for piece in pieces:
        chars = [dictionary[ch] for ch in piece if ch in dictionary and ch not in {"-", "*"}]
        if not chars:
            return None
        tokens.append(chars)
    try:
        spans = aligner(emission, tokens)
    except Exception as err:
        print(f"[align] CTC failed: {err}", file=sys.stderr, flush=True)
        return None
    if len(spans) != len(pieces):
        return None

    frames = int(emission.shape[0])

    def ms_at(frame: int) -> float:
        return origin_ms + frame * n_samples / max(frames, 1) / rate * 1000

    per_piece = []
    for group in spans:
        if not group:
            per_piece.append(None)
            continue
        per_piece.append(
            {
                "start": ms_at(group[0].start),
                "end": ms_at(group[-1].end),
                "confidence": float(sum(span.score for span in group) / len(group)),
            }
        )
    by_word: dict[int, list] = {}
    for owner, item in zip(owners, per_piece):
        by_word.setdefault(owner, []).append(item)

    placed = []
    cursor = origin_ms
    for index, word in enumerate(words):
        group = [item for item in by_word.get(index, []) if item]
        if group:
            raw_start = group[0]["start"]
            raw_end = group[-1]["end"]
            score = sum(item["confidence"] for item in group) / len(group)
        else:
            raw_start = cursor
            raw_end = cursor + 40
            score = 0.0
        made = _timed_word(word, raw_start, raw_end, score)
        placed.append(made)
        cursor = made["rawEndMs"]
    return placed


def _blank_word(word: dict, origin_ms: float) -> dict:
    return _timed_word(word, origin_ms, origin_ms + 40, 0.0)


def _timed_word(word: dict, raw_start: float, raw_end: float, score: float) -> dict:
    raw_end = max(raw_end, raw_start + 30)
    return {
        "text": word["text"],
        "line": word["line"],
        "rawStartMs": round(float(raw_start), 1),
        "rawEndMs": round(float(raw_end), 1),
        "startMs": round(float(raw_start), 1),
        "endMs": round(float(raw_end), 1),
        "confidence": round(float(score), 4),
    }


def align_span(samples: np.ndarray, rate: int, words: list[dict], origin_ms: float) -> list[dict] | None:
    audio = np.ascontiguousarray(samples, dtype=np.float32)
    if audio.size < 400:
        audio = np.pad(audio, (0, 400 - audio.size))
    return align_emission(forward(audio), int(audio.size), rate, words, origin_ms)


def fit_words(
    emission: torch.Tensor,
    n_samples: int,
    rate: int,
    words: list[dict],
    keep_end_rel_ms: float,
    origin_ms: float,
) -> tuple[int, list[dict] | None]:
    cache: dict[int, list[dict] | None] = {}

    def place(count: int) -> list[dict] | None:
        if count not in cache:
            cache[count] = align_emission(emission, n_samples, rate, words[:count], origin_ms)
        return cache[count]

    lo, hi = 1, len(words)
    best = 1
    while lo <= hi:
        mid = (lo + hi) // 2
        placed = place(mid)
        if not placed:
            hi = mid - 1
            continue
        last = placed[-1]
        last_start = float(last["rawStartMs"]) - origin_ms
        last_end = float(last["rawEndMs"]) - origin_ms
        if last_start >= keep_end_rel_ms - 50 or last_end > keep_end_rel_ms + 30:
            hi = mid - 1
        else:
            best = mid
            lo = mid + 1
    return best, place(best)


def realign_boundaries(samples: np.ndarray, rate: int, placed: list[dict], chunks: list[dict]) -> list[dict]:
    if len(chunks) < 2 or len(placed) < 2:
        return placed
    near_ms = OVERLAP_S * 1000 + 250
    for index in range(len(chunks) - 1):
        cut = chunks[index]["keep_end"] * 1000
        near = [i for i, word in enumerate(placed) if abs(float(word["rawStartMs"]) - cut) <= near_ms]
        if not near:
            continue
        j0 = min(near)
        j1 = max(near) + 1
        if j0 > 0 and cut - float(placed[j0 - 1]["rawStartMs"]) < 3000:
            j0 -= 1
        if j1 < len(placed) and float(placed[j1]["rawStartMs"]) - cut < 3000:
            j1 += 1
        if j1 - j0 < 1:
            continue
        window_start = max(0.0, cut / 1000 - OVERLAP_S)
        window_end = min(samples.size / rate, cut / 1000 + OVERLAP_S)
        a = int(round(window_start * rate))
        b = max(a + 1, int(round(window_end * rate)))
        source = [
            {"text": word["text"], "line": word["line"], "pieces": normalize_pieces(word["text"])}
            for word in placed[j0:j1]
        ]
        fresh = align_span(samples[a:b], rate, source, window_start * 1000)
        if not fresh or len(fresh) != j1 - j0:
            continue
        starts = [float(item["rawStartMs"]) for item in fresh]
        if any(starts[i] < starts[i - 1] for i in range(1, len(starts))):
            continue
        prev_limit = float(placed[j0 - 1]["startMs"]) if j0 else float("-inf")
        next_limit = float(placed[j1]["rawStartMs"]) if j1 < len(placed) else float("inf")
        if fresh[0]["rawStartMs"] <= prev_limit or fresh[-1]["rawStartMs"] >= next_limit:
            continue
        for offset, item in enumerate(fresh):
            target = placed[j0 + offset]
            target["rawStartMs"] = item["rawStartMs"]
            target["rawEndMs"] = item["rawEndMs"]
            target["startMs"] = item["startMs"]
            target["endMs"] = item["endMs"]
            target["confidence"] = item["confidence"]
    return placed


def align_chunked(samples: np.ndarray, rate: int, words: list[dict]) -> tuple[list[dict] | None, int]:
    duration = samples.size / rate
    chunks = plan_chunks(duration, long_silences(samples, rate))
    print(
        "[align] chunk-plan " + json.dumps([{key: round(value, 3) for key, value in chunk.items()} for chunk in chunks]),
        file=sys.stderr,
        flush=True,
    )
    if len(chunks) <= 1:
        return align_span(samples, rate, words, 0.0), len(chunks)

    cursor = 0
    placed: list[dict] = []
    emissions: list[torch.Tensor] = []
    for chunk in chunks:
        a = int(round(chunk["audio_start"] * rate))
        b = max(a + 1, int(round(chunk["audio_end"] * rate)))
        audio = np.ascontiguousarray(samples[a:b], dtype=np.float32)
        if audio.size < 400:
            audio = np.pad(audio, (0, 400 - audio.size))
        emissions.append(forward(audio))
        chunk["n_samples"] = int(audio.size)

    for index, chunk in enumerate(chunks[:-1]):
        remaining = words[cursor:]
        if not remaining:
            break
        origin = chunk["audio_start"] * 1000
        keep_end_rel = (chunk["keep_end"] - chunk["audio_start"]) * 1000
        count, part = fit_words(emissions[index], int(chunk["n_samples"]), rate, remaining, keep_end_rel, origin)
        if not part:
            return None, len(chunks)
        placed.extend(part)
        cursor += count
        if cursor >= len(words):
            break
    if cursor < len(words):
        last = chunks[-1]
        part = align_emission(emissions[-1], int(last["n_samples"]), rate, words[cursor:], last["audio_start"] * 1000)
        if part is None:
            return None, len(chunks)
        placed.extend(part)
    return realign_boundaries(samples, rate, placed, chunks), len(chunks)


def align_wav(path: str, text: str, isolated: bool, snap: bool = False) -> dict:
    samples, rate, channels = read_wav(path)
    resampled_from = None
    if rate != SAMPLE_RATE:
        resampled_from = rate
        samples = resample(samples, rate, SAMPLE_RATE)
        rate = SAMPLE_RATE
    duration_ms = samples.size / rate * 1000 if rate else 0
    words = parse_words(text)
    feed = {
        "path": path,
        "sampleRate": rate,
        "channels": 1,
        "sourceChannels": channels,
        "resampledFrom": resampled_from,
        "isolated": isolated,
        "snap": False,
        "model": "torchaudio.pipelines.MMS_FA",
        "method": "wav2vec2-ctc-one-pass",
        "durationMs": round(duration_ms, 1),
    }
    if not words:
        return {"ok": False, "error": "Paste the lyrics for this section first.", "feed": feed, "words": []}
    print(
        f"[align] feed path={path} sr={rate} ch={channels} resampledFrom={resampled_from} isolated={isolated} snap={bool(snap)} bytes={samples.size * 2}",
        file=sys.stderr,
        flush=True,
    )
    try:
        if duration_ms > MAX_CHUNK_S * 1000:
            placed, chunk_count = align_chunked(samples, rate, words)
            feed["method"] = "wav2vec2-ctc-one-pass" if chunk_count <= 1 else "wav2vec2-ctc-silence-chunks"
        else:
            placed = align_span(samples, rate, words, 0.0)
            feed["method"] = "wav2vec2-ctc-one-pass"
    except Exception as err:
        print(f"[align] failed: {err}", file=sys.stderr, flush=True)
        return {"ok": False, "error": f"Forced alignment failed. {err}", "feed": feed, "words": []}
    if not placed:
        return {"ok": False, "error": "Forced alignment failed on this stem.", "feed": feed, "words": []}

    warnings: list[str] = []
    if snap and isolated:
        apply_snap(placed, stem_onsets(samples, rate))
        feed["snap"] = True
    elif snap:
        warnings.append("Onset snap only runs on the isolated vocal, so it stayed off.")
    trim_overlaps(placed)
    low = sum(1 for word in placed if word["confidence"] < 0.5)
    if low:
        warnings.append(f"{low} word{' is' if low == 1 else 's are'} under 0.5 confidence and outlined in red.")
    preview = placed[:10]
    print("[align] first10 " + json.dumps(preview), file=sys.stderr, flush=True)
    return {
        "ok": True,
        "words": placed,
        "warning": " ".join(warnings) if warnings else None,
        "feed": feed,
    }


def _hold_stdout():
    held = sys.stdout
    sys.stdout = sys.stderr
    return held


def _release_stdout(held) -> None:
    sys.stdout = held


def serve() -> None:
    held = _hold_stdout()
    try:
        load_models()
    finally:
        _release_stdout(held)
    held.write(json.dumps({"ready": True}) + "\n")
    held.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = None
        held_job = _hold_stdout()
        try:
            job = json.loads(line)
            result = align_wav(job["wav"], job.get("text") or "", bool(job.get("isolated")), bool(job.get("snap")))
            result["id"] = job.get("id")
        except Exception as err:
            result = {"id": job.get("id") if isinstance(job, dict) else None, "ok": False, "error": str(err), "words": []}
        finally:
            _release_stdout(held_job)
        held.write(json.dumps(result) + "\n")
        held.flush()


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
        return
    if len(sys.argv) < 3:
        raise SystemExit("usage: align_lyrics.py --serve | align_lyrics.py file.wav lyrics [--mix] [--snap]")
    text = open(sys.argv[2], encoding="utf-8").read() if sys.argv[2].endswith(".txt") else sys.argv[2]
    isolated = "--mix" not in sys.argv
    snap = "--snap" in sys.argv
    sys.stdout.write(json.dumps(align_wav(sys.argv[1], text, isolated, snap)) + "\n")


if __name__ == "__main__":
    main()
