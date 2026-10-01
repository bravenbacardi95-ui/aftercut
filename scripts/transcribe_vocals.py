"""Resident faster-whisper transcriber aligned with MMS_FA.

`--serve` keeps the models loaded and reads one JSON job per line:
{"id", "wav"} -> {"id", "ok", "text", "words", "asrMs", "alignMs"}

Whisper receives a float32 16 kHz mono array. A file path is not passed
through, because PyAV 19 breaks faster_whisper.decode_audio.
"""

from __future__ import annotations

import json
import sys
import time

import numpy as np

import align_lyrics

_WHISPER = None
_WHISPER_NAME = ""


def _default_factory(name: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    return WhisperModel(name, device=device, compute_type=compute_type)


def load_whisper(factory=None):
    global _WHISPER, _WHISPER_NAME
    if _WHISPER is not None:
        return _WHISPER
    make = factory or _default_factory
    last: Exception | None = None
    for name in ("small.en", "base.en"):
        try:
            _WHISPER = make(name, "cpu", "int8")
            _WHISPER_NAME = name
            return _WHISPER
        except Exception as err:
            last = err
            print(f"[transcribe] {name} failed: {err}", file=sys.stderr, flush=True)
    raise RuntimeError(f"Could not load a whisper model. {last}")


def samples_16k(path: str) -> np.ndarray:
    samples, rate, _channels = align_lyrics.read_wav(path)
    if rate != 16000:
        samples = align_lyrics.resample(samples, rate, 16000)
    return np.ascontiguousarray(samples, dtype=np.float32)


def hear(samples: np.ndarray) -> str:
    if not isinstance(samples, np.ndarray) or samples.dtype != np.float32:
        raise TypeError("whisper audio must be a float32 array, not a path")
    model = load_whisper()
    segments, _info = model.transcribe(
        samples,
        language="en",
        beam_size=5,
        condition_on_previous_text=False,
    )
    parts: list[str] = []
    for segment in segments:
        text = (getattr(segment, "text", "") or "").strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _public_words(placed: list[dict]) -> list[dict]:
    words = []
    for word in placed:
        words.append(
            {
                "text": word["text"],
                "line": int(word["line"]),
                "startMs": int(round(float(word["startMs"]))),
                "endMs": int(round(float(word["endMs"]))),
                "confidence": float(word["confidence"]),
            }
        )
    return words


def transcribe_wav(path: str) -> dict:
    started = time.perf_counter()
    samples = samples_16k(path)
    text = hear(samples).strip()
    asr_ms = int((time.perf_counter() - started) * 1000)
    if not text:
        return {"ok": False, "error": "No speech heard in this clip.", "text": "", "words": [], "asrMs": asr_ms, "alignMs": 0}
    align_started = time.perf_counter()
    aligned = align_lyrics.align_wav(path, text, True, False)
    align_ms = int((time.perf_counter() - align_started) * 1000)
    if not aligned.get("ok"):
        return {
            "ok": False,
            "error": aligned.get("error") or "Forced alignment failed.",
            "text": text,
            "words": [],
            "asrMs": asr_ms,
            "alignMs": align_ms,
        }
    return {
        "ok": True,
        "text": text,
        "words": _public_words(aligned["words"]),
        "asrMs": asr_ms,
        "alignMs": align_ms,
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
        load_whisper()
        align_lyrics.load_models()
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
            result = transcribe_wav(job["wav"])
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
    if len(sys.argv) != 2:
        raise SystemExit("usage: transcribe_vocals.py --serve | transcribe_vocals.py file.wav")
    sys.stdout.write(json.dumps(transcribe_wav(sys.argv[1])) + "\n")


if __name__ == "__main__":
    main()
