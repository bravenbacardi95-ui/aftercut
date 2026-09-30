"""Separate a snippet with HTDemucs and write a normalized 16 kHz mono vocal stem.

`--serve` keeps the model loaded and reads one JSON job per line:
{"id", "wav", "out"} -> {"id", "ok", "error"?}
"""

from __future__ import annotations

import json
import sys
import wave

import numpy as np
import torch
import torchaudio
from demucs.apply import apply_model
from demucs.pretrained import get_model

MODEL_RATE = 44100
OUT_RATE = 16000
_MODEL = None


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise RuntimeError("expected 16-bit PCM wav")
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if data.size == 0:
        raise RuntimeError("empty audio")
    return data.reshape(-1, channels).T.copy(), rate


def write_wav(path: str, mono: np.ndarray, rate: int) -> None:
    clipped = np.clip(mono, -1, 1)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def resample(audio: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    if from_rate == to_rate or audio.size == 0:
        return np.ascontiguousarray(audio, dtype=np.float32)
    wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))
    squeeze = wav.ndim == 1
    if squeeze:
        wav = wav.unsqueeze(0)
    out = torchaudio.functional.resample(wav, from_rate, to_rate)
    numpy = np.ascontiguousarray(out.detach().cpu().numpy(), dtype=np.float32)
    return numpy[0] if squeeze else numpy


def load_model():
    global _MODEL
    if _MODEL is None:
        _MODEL = get_model("htdemucs")
        _MODEL.eval()
    return _MODEL


def separate(source: str, dest: str) -> None:
    audio, rate = read_wav(source)
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    else:
        audio = audio[:2]
    if rate != MODEL_RATE:
        audio = resample(audio, rate, MODEL_RATE)
    model = load_model()
    mix = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
    with torch.no_grad():
        stems = apply_model(model, mix, device="cpu", shifts=0, split=True, overlap=0.25, progress=False)
    names = list(model.sources)
    vocals = stems[0, names.index("vocals")].mean(dim=0).detach().cpu().numpy().astype(np.float32)
    peak = float(np.max(np.abs(vocals))) if vocals.size else 0.0
    if peak < 1e-5:
        raise RuntimeError("Vocal stem was silent.")
    vocals = np.clip(vocals / peak * 0.89, -1, 1)
    vocals = resample(vocals, MODEL_RATE, OUT_RATE)
    write_wav(dest, vocals, OUT_RATE)


def _hold_stdout():
    held = sys.stdout
    sys.stdout = sys.stderr
    return held


def _release_stdout(held) -> None:
    sys.stdout = held


def serve() -> None:
    held = _hold_stdout()
    try:
        load_model()
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
            separate(job["wav"], job["out"])
            result = {"id": job.get("id"), "ok": True}
        except Exception as err:
            result = {"id": job.get("id") if isinstance(job, dict) else None, "ok": False, "error": str(err)}
        finally:
            _release_stdout(held_job)
        held.write(json.dumps(result) + "\n")
        held.flush()


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: isolate_vocals.py --serve | isolate_vocals.py input.wav output.wav")
    try:
        separate(sys.argv[1], sys.argv[2])
    except Exception as err:
        raise SystemExit(str(err)) from err


if __name__ == "__main__":
    main()
