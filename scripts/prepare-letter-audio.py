"""Clean the retained v1 recordings and create uniform, pitch-preserved v2 audio.

Development dependencies: numpy, scipy, imageio-ffmpeg (FFmpeg with rubberband).
The source WAVs and their licenses stay intact for reproducible processing.
"""
import hashlib
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/audio/letters-v1'
OUTPUT = ROOT / 'public/audio/letters-v2'
RATE = 24000
SECONDS = .5
EDGE_SECONDS = .01
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def process(samples, filters):
    result = subprocess.run([
        FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', str(RATE),
        '-ac', '1', '-i', 'pipe:0', '-af', filters, '-f', 'f32le', '-ar', str(RATE),
        '-ac', '1', 'pipe:1',
    ], input=np.asarray(samples, dtype='<f4').tobytes(), capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').copy()


def db(rms):
    return round(float(20 * np.log10(max(float(rms), 1e-10))), 2)


def rms(samples):
    return float(np.sqrt(np.mean(samples.astype(float) ** 2)))


def prepare():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    originals = json.loads((SOURCE / 'attribution.json').read_text(encoding='utf8'))
    records = {}
    checks = {}
    for letter, original in originals.items():
        source = SOURCE / f'{letter}.wav'
        assert hashlib.sha256(source.read_bytes()).hexdigest() == original['sha256'], letter
        rate, pcm = wavfile.read(source)
        assert rate == RATE and pcm.dtype == np.int16 and pcm.ndim == 1, letter
        samples = pcm.astype(np.float32) / 32768
        # N has sustained broadband noise in its retained lead-in and tail.
        # Other letters use a gentler floor so fricatives remain intelligible.
        floor, reduction = (-32, 20) if letter == 'N' else (-48, 12)
        filters = f'highpass=f=85:p=2,lowpass=f=8500:p=2,adeclick=t=4,afftdn=nf={floor}:nr={reduction}:gs=6'
        cleaned = process(samples, filters)
        # Exclude the isolated post-utterance artifact visible in the source A.
        if letter == 'A':
            cleaned = cleaned[:round(.46 * RATE)]
        frame = round(.005 * RATE)
        levels = np.array([rms(cleaned[i:i+frame]) for i in range(0, len(cleaned), frame)])
        active = np.flatnonzero(levels > max(.0005, levels.max() * .04))
        assert len(active), letter
        start = max(0, active[0] * frame - round(.015 * RATE))
        end = min(len(cleaned), (active[-1] + 1) * frame + round(.015 * RATE))
        spoken = cleaned[start:end]
        target = round((SECONDS - 2 * EDGE_SECONDS) * RATE)
        tempo = len(spoken) / target
        for attempt in range(6):
            stretched = process(spoken, f'rubberband=tempo={tempo:.10f}:pitch=1:transients=mixed:formant=preserved')
            if abs(len(stretched) - target) <= RATE * .004:
                break
            tempo *= len(stretched) / target
        # Correct the processor's short-clip rounding, never cut off a syllable.
        assert abs(len(stretched) - target) <= RATE * .004, (letter, len(stretched), target)
        stretched = np.pad(stretched, (0, max(0, target - len(stretched))))[:target]
        # A short fade avoids discontinuities between recordings and silence.
        fade = round(.008 * RATE)
        stretched[:fade] *= np.linspace(0, 1, fade)
        stretched[-fade:] *= np.linspace(1, 0, fade)
        # Use look-ahead peak limiting so a brief consonant peak does not make
        # the entire recording quieter than the other letters.
        for attempt in range(4):
            stretched *= .13 / max(rms(stretched), .0001)
            if np.max(np.abs(stretched)) <= .89:
                break
            stretched = process(stretched, 'alimiter=limit=0.8:attack=1:release=30:level=false:latency=true')
        assert np.max(np.abs(stretched)) <= .89 and abs(rms(stretched) - .13) < .001, letter
        result = np.pad(stretched, (round(EDGE_SECONDS * RATE), round(EDGE_SECONDS * RATE)))
        assert len(result) == round(SECONDS * RATE)
        output = OUTPUT / f'{letter}.wav'
        wavfile.write(output, RATE, np.round(result * 32767).astype(np.int16))
        _, saved_pcm = wavfile.read(output)
        result = saved_pcm.astype(np.float32) / 32768
        records[letter] = {
            **original,
            'changes': '85 Hz high-pass, 8.5 kHz low-pass, click removal, FFT noise reduction, surrounding noise/silence trimmed, pitch-preserving Rubberband time stretch to 0.5 s including 10 ms silent edges, 8 ms fades, equal RMS normalization with look-ahead peak limiting when needed.' + (' Post-utterance artifact removed.' if letter == 'A' else ''),
            'duration': SECONDS,
            'inputSha256': original['sha256'],
            'inputDuration': len(samples) / RATE,
            'processedTrimStart': start / RATE,
            'processedTrimEnd': end / RATE,
            'tempoFactor': tempo,
            'noiseFloorDb': floor,
            'noiseReductionDb': reduction,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        }
        checks[letter] = {
            'sha256': records[letter]['sha256'],
            'durationSeconds': len(result) / RATE,
            'inputDurationSeconds': len(samples) / RATE,
            'peakDbfs': db(np.max(np.abs(result))),
            'rmsDbfs': db(rms(result)),
            'clippedSamples': int(np.sum(np.abs(result) >= 1)),
            'boundarySamplesZero': bool(np.all(result[:240] == 0) and np.all(result[-240:] == 0)),
            'inputDcOffset': float(np.mean(samples)),
            'outputDcOffset': float(np.mean(result)),
            'inputEdgeRmsDbfs': db(rms(np.concatenate([samples[:240], samples[-240:]]))),
            'filteredEdgeRmsDbfs': db(rms(np.concatenate([cleaned[:240], cleaned[-240:]]))),
        }
        if letter == 'N':
            checks[letter]['leadInNoiseBeforeDbfs'] = db(rms(samples[:round(.25 * RATE)]))
            checks[letter]['leadInNoiseAfterFilteringDbfs'] = db(rms(cleaned[:round(.25 * RATE)]))
        print(json.dumps({'letter': letter, 'tempo': round(tempo, 3), **checks[letter]}), flush=True)
    (OUTPUT / 'attribution.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    report = {
        'method': 'Deterministic decoded-PCM checks and conservative noise reduction of all 26 recordings; not a human listening test.',
        'limitations': 'Endpoint RMS can include speech or filter delay and is not an SNR estimate. Only N has a verified 0.25 s noise-only lead-in for the before/after noise measurement.',
        'sourceDirectory': 'public/audio/letters-v1',
        'outputDirectory': 'public/audio/letters-v2',
        'targetDurationSeconds': SECONDS,
        'ffmpegVersion': subprocess.check_output([FFMPEG, '-version'], text=True).splitlines()[0],
        'letters': checks,
    }
    (ROOT / 'docs/letter-audio-cleanup.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')


if __name__ == '__main__':
    prepare()
