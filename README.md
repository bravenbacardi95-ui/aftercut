# Aftercut

Lyric video editor. Paste lyrics, isolate the vocal, and force-align every word to the snippet.

Vocal isolation and alignment run on the machine that starts the app. They are not browser-only.

| Piece | Where |
|---|---|
| Vocal isolation | Resident `scripts/isolate_vocals.py` (HTDemucs), started from `src/lib/studio/isolate.fn.ts` |
| Forced alignment | Resident `scripts/align_lyrics.py` (torchaudio MMS_FA wav2vec2 CTC), started from `src/lib/studio/align.fn.ts` |

Sync aligns every pasted word in one MMS_FA pass over the whole vocal stem, then keeps the line breaks from the paste. Snippets longer than 60 seconds are split at long silences, with overlap, and the words on that boundary are aligned again. Onset snap is off unless you turn it on. It can move a start at most 40 ms earlier or later, and only onto an onset in the isolated stem.

The Node server keeps one Python process for alignment and one for Demucs. Both use `ALIGNER_PYTHON`. They do not call `python3` from `PATH`. If that interpreter is missing, or a worker dies, Sync shows the error and stops. A failed isolation does not fall back to the full mix.

## Requirements

- Node.js 22
- npm 10
- Python 3.10 or newer
- About 8 GB of free disk for the models (downloaded on first use)

## Run locally

```bash
git clone https://github.com/bravenbacardi95-ui/aftercut.git
cd aftercut
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export ALIGNER_PYTHON="$(pwd)/.venv/bin/python"
npm run dev
```

On Windows, activate with `.venv\Scripts\activate` and set the interpreter with `set ALIGNER_PYTHON=%CD%\.venv\Scripts\python.exe`.

If `ALIGNER_PYTHON` is unset, the server uses `.venv/bin/python` (or `.venv\Scripts\python.exe`) when that file exists. It still will not use `python3` from `PATH`.

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

The dev server listens on `0.0.0.0:8080`.

## First Sync and Solo vocal

The first **Solo vocal** or **Sync lyrics** downloads models into the PyTorch hub cache (`~/.cache/torch/hub`):

- HTDemucs vocal stem, about 80 MB
- MMS forced-alignment model, about 1.2 GB

CPU is enough. A 30 second snippet takes roughly 25 seconds to separate the first time the model is loaded. The Demucs process stays up after that, and a later sync of the same window reuses the stem.

Cloud transcription is optional and only used by **Transcribe instead**:

```bash
export XAI_API_KEY=your_xai_key
npm run dev
```

Sync and vocal isolation do not use that key.

## Checks

```bash
npx tsc --noEmit
node --experimental-strip-types --test src/lib/studio/align-lyrics.test.ts src/lib/studio/vocal-activity.test.ts
python scripts/test_align_lyrics.py
```

The Python test loads MMS_FA. The first run downloads it if it is not already cached.
