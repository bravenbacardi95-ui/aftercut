# Aftercut

Lyric video editor. Paste lyrics, isolate the vocal, and force-align every word to the snippet.

Vocal isolation and alignment run on the machine that starts the app. They are not browser-only.

| Piece | Where |
|---|---|
| Vocal isolation | `scripts/isolate_vocals.py` (HTDemucs), called from `src/lib/studio/isolate.fn.ts` |
| Forced alignment | `scripts/align_lyrics.py` (torchaudio MMS_FA wav2vec2 CTC), called from `src/lib/studio/align.fn.ts` |

The Node server keeps one Python aligner process alive and spawns isolation per snippet.

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
npm run dev
```

On Windows, activate with `.venv\Scripts\activate` instead of `source .venv/bin/activate`.

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

The dev server listens on `0.0.0.0:8080`.

## First Sync and Solo vocal

The first **Solo vocal** or **Sync lyrics** downloads models into the PyTorch hub cache (`~/.cache/torch/hub`):

- HTDemucs vocal stem, about 80 MB
- MMS forced-alignment model, about 1.2 GB

CPU is enough. A 30 second snippet takes roughly 25 seconds to separate once the model is cached. Later syncs of the same window reuse the stem.

Cloud transcription is optional and only used by **Transcribe instead**:

```bash
export XAI_API_KEY=your_xai_key
npm run dev
```

Sync and vocal isolation do not use that key.

## Checks

```bash
npx tsc --noEmit
node --experimental-strip-types --test src/lib/studio/align-lyrics.test.ts
```
