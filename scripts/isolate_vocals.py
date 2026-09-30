"""Separate a snippet with HTDemucs and write a normalized 16 kHz mono vocal stem."""

import sys
import wave

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

MODEL_RATE = 44100
OUT_RATE = 16000


def read_wav(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise SystemExit("expected 16-bit PCM wav")
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if data.size == 0:
        raise SystemExit("empty audio")
    return data.reshape(-1, channels).T.copy(), rate


def write_wav(path: str, mono: np.ndarray, rate: int) -> None:
    clipped = np.clip(mono, -1, 1)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())


def resample(mono: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    if from_rate == to_rate or mono.size == 0:
        return mono
    length = max(1, int(round(mono.size * to_rate / from_rate)))
    position = np.linspace(0, mono.size - 1, length)
    left = np.floor(position).astype(np.int64)
    right = np.minimum(left + 1, mono.size - 1)
    frac = (position - left).astype(np.float32)
    return mono[left] * (1 - frac) + mono[right] * frac


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: isolate_vocals.py input.wav output.wav")
    source, dest = sys.argv[1], sys.argv[2]
    audio, rate = read_wav(source)
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    else:
        audio = audio[:2]
    if rate != MODEL_RATE:
        audio = np.stack([resample(audio[c], rate, MODEL_RATE) for c in range(audio.shape[0])])
    model = get_model("htdemucs")
    model.eval()
    mix = torch.from_numpy(np.ascontiguousarray(audio)).unsqueeze(0)
    with torch.no_grad():
        stems = apply_model(model, mix, device="cpu", shifts=0, split=True, overlap=0.25, progress=False)
    names = list(model.sources)
    vocals = stems[0, names.index("vocals")].mean(dim=0).detach().cpu().numpy().astype(np.float32)
    peak = float(np.max(np.abs(vocals))) if vocals.size else 0.0
    if peak < 1e-5:
        raise SystemExit("vocal stem was silent")
    vocals = np.clip(vocals / peak * 0.89, -1, 1)
    vocals = resample(vocals, MODEL_RATE, OUT_RATE)
    write_wav(dest, vocals, OUT_RATE)


if __name__ == "__main__":
    main()
