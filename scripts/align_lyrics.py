"""wav2vec2 CTC forced alignment (torchaudio MMS_FA) for one vocal stem.

Times are relative to the start of the wav that was passed in.
"""

from __future__ import annotations

import json
import sys
import wave

import numpy as np
import torch
from torchaudio.pipelines import MMS_FA

SAMPLE_RATE = 16000
LETTERS = set("abcdefghijklmnopqrstuvwxyz'")
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
    text = __import__("re").sub(r"\d+", lambda match: " " + spell(int(match.group(0))) + " ", text)
    text = __import__("re").sub(r"[^a-z'\s]", " ", text)
    pieces = []
    for part in text.split():
        cleaned = "".join(ch for ch in part if ch in LETTERS)
        if cleaned:
            pieces.append(cleaned)
    return pieces


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
        return mono
    length = max(1, int(round(mono.size * to_rate / from_rate)))
    position = np.linspace(0, mono.size - 1, length)
    left = np.floor(position).astype(np.int64)
    right = np.minimum(left + 1, mono.size - 1)
    frac = (position - left).astype(np.float32)
    return mono[left] * (1 - frac) + mono[right] * frac


def load_models():
    global _MODEL, _TOKENIZER, _ALIGNER
    if _MODEL is None:
        _MODEL = MMS_FA.get_model()
        _MODEL.eval()
        _TOKENIZER = MMS_FA.get_tokenizer()
        _ALIGNER = MMS_FA.get_aligner()
    return _MODEL, _TOKENIZER, _ALIGNER


def vocal_activity(samples: np.ndarray, rate: int) -> tuple[list[tuple[float, float]], list[float]]:
    hop = 160
    window = 400
    if samples.size < window:
        return [], []
    count = 1 + (samples.size - window) // hop
    rms = np.empty(count, dtype=np.float32)
    flux = np.empty(count, dtype=np.float32)
    previous = None
    for index in range(count):
        frame = samples[index * hop : index * hop + window]
        rms[index] = float(np.sqrt(np.mean(frame * frame) + 1e-12))
        spec = np.abs(np.fft.rfft(frame * np.hanning(window)))
        if previous is None:
            flux[index] = 0
        else:
            flux[index] = float(np.mean(np.maximum(0, spec - previous)))
        previous = spec
    floor = float(np.percentile(rms, 25))
    peak = float(np.percentile(rms, 95))
    span = max(1e-6, peak - floor)
    on_th = floor + 0.22 * span
    off_th = floor + 0.12 * span
    regions: list[tuple[float, float]] = []
    active = False
    start = 0
    for index, level in enumerate(rms):
        if not active and level >= on_th:
            active = True
            start = index
            while start > 0 and rms[start - 1] > off_th:
                start -= 1
        elif active and level < off_th:
            active = False
            if index - start >= 3:
                regions.append((start * hop / rate * 1000, index * hop / rate * 1000))
    if active and count - start >= 3:
        regions.append((start * hop / rate * 1000, count * hop / rate * 1000))
    merged: list[tuple[float, float]] = []
    for region in regions:
        if merged and region[0] - merged[-1][1] < 90:
            merged[-1] = (merged[-1][0], region[1])
        else:
            merged.append(region)
    flux_peak = float(np.percentile(flux, 90)) or 1e-6
    peaks: list[float] = []
    for index in range(1, count - 1):
        if flux[index] >= flux[index - 1] and flux[index] >= flux[index + 1] and flux[index] > flux_peak * 0.45:
            peaks.append(index * hop / rate * 1000)
    onsets: list[float] = []
    for at in sorted([start for start, _end in merged] + peaks):
        if not onsets or at - onsets[-1] >= 50:
            onsets.append(at)
    return merged, onsets


def split_regions(regions: list[tuple[float, float]], onsets: list[float], need: int) -> list[tuple[float, float]]:
    regions = list(regions)
    guard = 0
    while len(regions) < need and guard < 24:
        guard += 1
        index = max(range(len(regions)), key=lambda i: regions[i][1] - regions[i][0])
        start, end = regions[index]
        if end - start < 160:
            break
        midpoint = (start + end) / 2
        inside = [onset for onset in onsets if start + 50 < onset < end - 50]
        cut = min(inside, key=lambda onset: abs(onset - midpoint)) if inside else midpoint
        regions[index : index + 1] = [(start, cut), (cut, end)]
    return regions


def group_regions(regions: list[tuple[float, float]], weights: list[float]) -> list[tuple[float, float]] | None:
    count = len(regions)
    lines = len(weights)
    if count == 0 or lines == 0:
        return None
    if count < lines:
        return None
    durations = [end - start for start, end in regions]
    total = sum(durations) or 1
    weight_sum = sum(weights) or 1
    targets = [total * weight / weight_sum for weight in weights]
    inf = 1e18
    cost = [[inf] * (lines + 1) for _ in range(count + 1)]
    prev = [[-1] * (lines + 1) for _ in range(count + 1)]
    cost[0][0] = 0
    for end in range(1, count + 1):
        for start in range(end):
            span = sum(durations[start:end])
            for line in range(1, lines + 1):
                if cost[start][line - 1] >= inf:
                    continue
                next_cost = cost[start][line - 1] + abs(span - targets[line - 1])
                if next_cost < cost[end][line]:
                    cost[end][line] = next_cost
                    prev[end][line] = start
    if cost[count][lines] >= inf:
        return None
    groups = []
    end = count
    line = lines
    while line > 0:
        start = prev[end][line]
        groups.append((regions[start][0], regions[end - 1][1]))
        end = start
        line -= 1
    groups.reverse()
    return groups


def snap_limit(norm: str, raw_dur: float) -> float:
    if raw_dur >= 350 or (norm[:1] in "aeiou"):
        return 120
    return 60


def snap_start(start: float, onsets: list[float], limit: float, lo: float, hi: float) -> float:
    candidates = [onset for onset in onsets if abs(onset - start) <= limit and lo < onset < hi]
    if not candidates:
        return start
    return min(candidates, key=lambda onset: abs(onset - start))


SHORT_WORDS = {"i", "a", "the", "keep"}


def parse_lines(text: str) -> list[dict]:
    lines = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        raw_words = raw_line.split()
        if not raw_words:
            continue
        words = []
        adlib = False
        for raw in raw_words:
            if "(" in raw:
                adlib = True
            words.append({"text": raw, "norm": normalize_pieces(raw), "adlib": adlib})
            if ")" in raw:
                adlib = False
        weight = sum(len("".join(word["norm"])) for word in words if not word["adlib"]) or 1
        lines.append({"words": words, "weight": weight, "adlib_only": all(word["adlib"] for word in words)})
    return lines


def encode_pieces(pieces: list[str], dictionary: dict[str, int]) -> list[list[int]] | None:
    star = dictionary.get("*")
    if star is None:
        return None
    tokens = [[star]]
    for piece in pieces:
        chars = [dictionary[ch] for ch in piece if ch in dictionary and ch not in {"*", "-"}]
        if not chars:
            return None
        tokens.append(chars)
    return tokens


def align_wav(path: str, text: str, isolated: bool) -> dict:
    samples, rate, channels = read_wav(path)
    resampled_from = None
    if rate != SAMPLE_RATE:
        resampled_from = rate
        samples = resample(samples, rate, SAMPLE_RATE)
        rate = SAMPLE_RATE
    feed = {
        "path": path,
        "sampleRate": rate,
        "channels": 1 if channels else 1,
        "sourceChannels": channels,
        "resampledFrom": resampled_from,
        "isolated": isolated,
        "model": "torchaudio.pipelines.MMS_FA",
        "method": "wav2vec2-ctc-forced-align",
    }
    print(
        f"[align] feed path={path} sr={rate} ch={channels} resampledFrom={resampled_from} isolated={isolated} bytes={samples.size * 2}",
        file=sys.stderr,
        flush=True,
    )
    lines = parse_lines(text)
    if not lines:
        return {"ok": False, "error": "Paste the lyrics for this section first.", "feed": feed, "words": []}
    regions, onsets = vocal_activity(samples, rate)
    duration_ms = samples.size / rate * 1000
    main_indexes = [index for index, line in enumerate(lines) if not line["adlib_only"]]
    if not main_indexes:
        main_indexes = list(range(len(lines)))
    if len(regions) < len(main_indexes):
        regions = split_regions(regions, onsets, len(main_indexes))
    main_windows = group_regions(regions, [lines[index]["weight"] for index in main_indexes])
    if not main_windows:
        if not regions:
            return {
                "ok": False,
                "error": "No vocal was found in the stem, so the lines were not aligned.",
                "feed": feed,
                "words": [],
            }
        main_windows = [(regions[0][0], regions[-1][1])] * len(main_indexes)
    for index in range(len(main_windows) - 1):
        start, end = main_windows[index]
        nxt, nxt_end = main_windows[index + 1]
        if end > nxt:
            mid = (end + nxt) / 2
            main_windows[index] = (start, mid)
            main_windows[index + 1] = (mid, nxt_end)
    window_of: dict[int, tuple[float, float]] = {}
    for index, window in zip(main_indexes, main_windows):
        window_of[index] = window
    for index, line in enumerate(lines):
        if index in window_of:
            continue
        prev_end = 0.0
        next_start = duration_ms
        for other in main_indexes:
            if other < index:
                prev_end = max(prev_end, window_of[other][1])
            elif other > index:
                next_start = min(next_start, window_of[other][0])
        window_of[index] = (prev_end, max(prev_end + 120, next_start))

    print(
        f"[align] regions={[(round(a), round(b)) for a, b in regions[:12]]} windows={[(i, round(a), round(b)) for i, (a, b) in window_of.items()]}",
        file=sys.stderr,
        flush=True,
    )
    model, _tokenizer, aligner = load_models()
    dictionary = MMS_FA.get_dict()
    waveform = torch.from_numpy(samples).unsqueeze(0)
    with torch.inference_mode():
        emission, _ = model(waveform)
    frames = emission.shape[1]
    samples_n = waveform.shape[1]

    def frame_at(ms: float) -> int:
        return int(round(max(0, min(duration_ms, ms)) / 1000 * rate * frames / max(1, samples_n)))

    def ms_at(frame: int) -> float:
        return frame * samples_n / frames / rate * 1000

    def align_pieces(pieces: list[str], start_ms: float, end_ms: float) -> list[dict] | None:
        tokens = encode_pieces(pieces, dictionary)
        if not tokens:
            return None
        f0 = frame_at(start_ms)
        f1 = max(f0 + 2, frame_at(end_ms))
        slice_emission = emission[0, f0:f1]
        needed = sum(len(group) for group in tokens)
        if slice_emission.shape[0] <= needed:
            return None
        try:
            spans = aligner(slice_emission, tokens)
        except Exception as err:
            print(f"[align] CTC failed: {err}", file=sys.stderr, flush=True)
            return None
        # spans[0] is the leading star/blank so the first real word is not pinned to the window edge
        found = []
        for piece, group in zip(pieces, spans[1:]):
            if not group:
                found.append(None)
                continue
            found.append(
                {
                    "rawStartMs": ms_at(f0 + group[0].start),
                    "rawEndMs": ms_at(f0 + group[-1].end),
                    "confidence": float(sum(span.score for span in group) / len(group)),
                }
            )
        return found

    def finish_word(display: str, line_index: int, raw_start: float, raw_end: float, score: float, lo: float, hi: float, line_onsets: list[float]) -> dict:
        norm = "".join(normalize_pieces(display))
        limit = snap_limit(norm, max(0, raw_end - raw_start))
        start = raw_start
        if score < 0.5:
            midpoint = (raw_start + raw_end) / 2
            containing = [region for region in regions if region[0] - 20 <= midpoint <= region[1] + 20]
            if containing and lo < containing[0][0] <= raw_start and containing[0][0] < hi:
                start = containing[0][0]
        start = snap_start(start, line_onsets, limit, lo, hi)
        if start >= hi:
            start = min(raw_start, hi - 20)
        return {
            "text": display,
            "line": line_index,
            "rawStartMs": round(raw_start, 1),
            "startMs": round(start, 1),
            "endMs": round(max(start + 40, raw_end), 1),
            "confidence": round(score, 4),
        }

    placed: list[dict] = []
    for line_index, line in enumerate(lines):
        window_start, window_end = window_of[line_index]
        prev_window = window_of.get(line_index - 1)
        next_window = window_of.get(line_index + 1)
        pad_start = window_start - 150
        pad_end = window_end + 150
        if prev_window:
            pad_start = max(pad_start, (prev_window[1] + window_start) / 2)
        if next_window:
            pad_end = min(pad_end, (window_end + next_window[0]) / 2)
        start_ms = max(0, pad_start)
        end_ms = min(duration_ms, max(start_ms + 80, pad_end))
        line_onsets = [onset for onset in onsets if start_ms - 30 <= onset <= end_ms + 30]
        main_words = [word for word in line["words"] if not word["adlib"]]
        if line["adlib_only"]:
            main_words = []
        line_placed: list[dict] = []
        main_pieces = [piece for word in main_words for piece in word["norm"]]
        main_spans = align_pieces(main_pieces, start_ms, end_ms) if main_pieces else None
        cursor = 0
        previous_start = start_ms - 1
        for word_index, word in enumerate(main_words):
            display = word["text"]
            piece_count = len(word["norm"])
            group = main_spans[cursor : cursor + piece_count] if main_spans is not None else None
            cursor += piece_count
            usable = [item for item in group or [] if item]
            next_raw = end_ms
            if main_spans is not None:
                for item in main_spans[cursor:]:
                    if item:
                        next_raw = item["rawStartMs"]
                        break
            if usable:
                raw_start = usable[0]["rawStartMs"]
                raw_end = usable[-1]["rawEndMs"]
                score = sum(item["confidence"] for item in usable) / len(usable)
                made = finish_word(display, line_index, raw_start, raw_end, score, previous_start, next_raw, line_onsets)
            else:
                onset = line_onsets[word_index] if word_index < len(line_onsets) else start_ms
                made = finish_word(display, line_index, onset, onset + 80, 0, previous_start, end_ms, line_onsets)
            line_placed.append(made)
            previous_start = made["startMs"]
        placed_main = list(line_placed)
        groups: list[tuple[int, list[dict]]] = []
        current: list[dict] = []
        after_main = -1
        seen_main = -1
        for word in line["words"]:
            if word["adlib"]:
                current.append(word)
                if ")" in word["text"]:
                    groups.append((after_main, current))
                    current = []
            else:
                if current:
                    groups.append((after_main, current))
                    current = []
                seen_main += 1
                after_main = seen_main
        if current:
            groups.append((after_main, current))
        for after_main, group in groups:
            if after_main < 0:
                gap_start = start_ms
                gap_end = placed_main[0]["startMs"] if placed_main else end_ms
            else:
                gap_start = placed_main[after_main]["endMs"]
                gap_end = placed_main[after_main + 1]["startMs"] if after_main + 1 < len(placed_main) else end_ms
            if gap_end - gap_start < 40:
                gap_end = gap_start + 80
            pieces = [piece for word in group for piece in word["norm"]]
            spans = align_pieces(pieces, gap_start, gap_end) if pieces else None
            piece_cursor = 0
            guard = gap_start
            for word in group:
                count = len(word["norm"])
                chunk = spans[piece_cursor : piece_cursor + count] if spans is not None else None
                piece_cursor += count
                usable = [item for item in chunk or [] if item]
                if usable:
                    made = finish_word(
                        word["text"],
                        line_index,
                        usable[0]["rawStartMs"],
                        usable[-1]["rawEndMs"],
                        sum(item["confidence"] for item in usable) / len(usable),
                        guard,
                        gap_end,
                        line_onsets,
                    )
                else:
                    made = finish_word(word["text"], line_index, guard, min(gap_end, guard + 80), 0, guard, gap_end, line_onsets)
                line_placed.append(made)
                guard = made["startMs"]
        line_placed.sort(key=lambda word: word["startMs"])
        for _pass in range(2):
            for index, word in enumerate(line_placed):
                norm = "".join(normalize_pieces(word["text"]))
                eligible = index == 0 or norm in SHORT_WORDS
                if not eligible or word["confidence"] >= 0.5:
                    continue
                limit = snap_limit(norm, 0)
                if not any(abs(onset - word["startMs"]) <= limit for onset in line_onsets):
                    continue
                neighbors = [line_placed[index - 1]["confidence"] if index else 0, line_placed[index + 1]["confidence"] if index + 1 < len(line_placed) else 0]
                strong = max(neighbors)
                if strong >= 0.5:
                    word["confidence"] = round(max(word["confidence"], strong), 4)
        placed.extend(line_placed)
    placed.sort(key=lambda word: (word["line"], word["startMs"]))
    for index in range(1, len(placed)):
        prev = placed[index - 1]
        word = placed[index]
        if word["line"] != prev["line"]:
            continue
        if word["startMs"] < prev["endMs"]:
            prev["endMs"] = round(max(prev["startMs"] + 30, word["startMs"]), 1)
        if word["endMs"] < word["startMs"] + 30:
            word["endMs"] = round(word["startMs"] + 40, 1)
    low = sum(1 for word in placed if word["confidence"] < 0.5)
    warning = None
    if low:
        warning = f"{low} word{' is' if low == 1 else 's are'} under 0.5 confidence and outlined in red."
    preview = placed[:10]
    print("[align] first10 " + json.dumps(preview), file=sys.stderr, flush=True)
    return {"ok": True, "words": placed, "warning": warning, "feed": feed}


def serve() -> None:
    load_models()
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            result = align_wav(job["wav"], job.get("text") or "", bool(job.get("isolated")))
            result["id"] = job.get("id")
        except Exception as err:
            result = {"id": job.get("id") if "job" in locals() else None, "ok": False, "error": str(err), "words": []}
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
        return
    if len(sys.argv) < 3:
        raise SystemExit("usage: align_lyrics.py --serve | align_lyrics.py file.wav lyrics.txt [--mix]")
    text = open(sys.argv[2], encoding="utf-8").read() if sys.argv[2].endswith(".txt") else sys.argv[2]
    isolated = "--mix" not in sys.argv
    sys.stdout.write(json.dumps(align_wav(sys.argv[1], text, isolated)) + "\n")


if __name__ == "__main__":
    main()
