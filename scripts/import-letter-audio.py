"""Import reusable US letter recordings; trim silence and normalize volume.

Requires numpy and soundfile. No runtime speech service or credentials.
"""
import concurrent.futures
import hashlib
import html
import io
import json
import re
import string
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/audio/letters-v1'
OUTPUT.mkdir(parents=True, exist_ok=True)
RATE = 24000


def get(url):
    for attempt in range(4):
        try:
            with urlopen(Request(url, headers={'User-Agent': 'GRERootsLetterAudio/1.0 (https://github.com/KennethWYLee/GRE)'}), timeout=40) as response:
                return response.read()
        except HTTPError as error:
            if error.code != 429 or attempt == 3:
                raise
            time.sleep(max(5 * (attempt + 1), int(error.headers.get('Retry-After', '0'))))


query = urlencode({'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                   'iiprop': 'url|extmetadata',
                   'titles': '|'.join(f'File:En-us-{c}.ogg' for c in string.ascii_lowercase)})
pages = json.loads(get('https://commons.wikimedia.org/w/api.php?' + query))['query']['pages'].values()


def convert(page):
    letter = re.search(r'En-us-([a-z])\.ogg', page['title'], re.I)[1].upper()
    info = page['imageinfo'][0]
    meta = info['extmetadata']
    license_name = meta['LicenseShortName']['value']
    assert license_name in ['CC BY-SA 3.0', 'Public domain'], license_name
    original = get(info['url'].split('?')[0])
    data, rate = sf.read(io.BytesIO(original), dtype='float32', always_2d=True)
    data = data.mean(axis=1)
    frame = max(1, int(rate * .005))
    rms = np.array([np.sqrt(np.mean(data[i:i+frame] ** 2)) for i in range(0, len(data), frame)])
    active = np.where(rms > max(.001, rms.max() * .015))[0]
    assert len(active), letter
    # Keep consonant attacks/releases; remove only the surrounding dead air.
    start = max(0, int(active[0] * frame - rate * .02))
    end = min(len(data), int((active[-1] + 1) * frame + rate * .02))
    trimmed = data[start:end]
    trimmed = np.interp(np.arange(round(len(trimmed) * RATE / rate)) * rate / RATE,
                        np.arange(len(trimmed)), trimmed).astype('float32')
    trimmed *= .8 / max(.001, float(np.max(np.abs(trimmed))))
    path = OUTPUT / f'{letter}.wav'
    sf.write(path, trimmed, RATE, subtype='PCM_16')
    return letter, {
        'file': f'{letter}.wav', 'source': info['descriptionurl'],
        'sourceAudio': info['url'].split('?')[0],
        'author': html.unescape(re.sub('<[^>]+>', '', meta['Artist']['value'])),
        'license': license_name,
        'licenseUrl': 'https://creativecommons.org/licenses/by-sa/3.0/' if license_name == 'CC BY-SA 3.0'
                      else 'https://creativecommons.org/publicdomain/mark/1.0/',
        'changes': 'Surrounding silence trimmed, mono 24 kHz PCM WAV, peak normalized; no pitch or speed change.',
        'duration': len(trimmed) / RATE, 'originalDuration': len(data) / rate,
        'trimStart': start / rate, 'trimEnd': end / rate,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
    recordings = dict(sorted(executor.map(convert, pages)))
assert ''.join(recordings) == string.ascii_uppercase
(OUTPUT / 'attribution.json').write_text(json.dumps(recordings, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps({c: round(r['duration'], 3) for c, r in recordings.items()}))
