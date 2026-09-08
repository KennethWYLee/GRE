"""Independent ASR check of actual WAV content, not the intended TTS text.

Requires faster-whisper, numpy and scipy (development-only).
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--model-cache', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--model', default='small.en')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1] / 'public/audio/letters-v2'
samples = {}
for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
    rate, pcm = wavfile.read(root / f'{letter}.wav')
    assert rate == 24000 and pcm.dtype == np.int16
    samples[letter] = pcm.astype(np.float32) / 32768
tests = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'QWERTYUIOPASDFGHJKLZXCVBNM', 'APPLE', 'BOOKKEEPER', 'WXYZ', 'AGHIJ', 'NINON', 'ONION']
print('Loading independent English speech recognizer...', flush=True)
model = WhisperModel(args.model, device='cpu', compute_type='int8', download_root=str(args.model_cache))
results = []
for letters in tests:
    parts = [np.zeros(7200, dtype='float32')]
    for index, c in enumerate(letters):
        parts.append(samples[c])
        parts.append(np.zeros(7200 if index == len(letters)-1 else 2400, dtype='float32'))
    sound = np.concatenate(parts)
    path = args.output / f'{letters}.wav'
    wavfile.write(path, 24000, np.round(sound * 32768).astype(np.int16))
    segments, _ = model.transcribe(str(path), language='en', beam_size=5, condition_on_previous_text=False,
                                   vad_filter=False, temperature=0)
    transcript = ''.join(segment.text for segment in segments).strip()
    result = {'expected': letters, 'transcript': transcript,
              'matches': re.sub('[^A-Z]', '', transcript.upper()) == letters,
              'duration': len(sound) / 24000,
              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    results.append(result)
    print(json.dumps(result), flush=True)
(args.output / 'asr-results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
report = {'method': 'Independent unprompted speech recognition of actual decoded PCM audio; not a human listening test.',
          'model': f'faster-whisper {args.model}', 'language': 'en', 'letterGapSeconds': .1,
          'wordGapSeconds': .3,
          'audioDirectory': 'public/audio/letters-v2', 'letterDurationSeconds': .5,
          'recordingHashes': {c: hashlib.sha256((root / f'{c}.wav').read_bytes()).hexdigest() for c in samples},
          'results': results}
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
assert all(result['matches'] for result in results), 'Actual audio transcription mismatch; review before publishing'
