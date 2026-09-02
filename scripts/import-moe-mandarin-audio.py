"""Import unmodified MOE Concised Mandarin Dictionary entry recordings.

The source archive is a split ZIP64 file. This script downloads the small
metadata archive, reads the remote ZIP central directory with HTTP range
requests, and fetches only recordings whose headword exactly matches a GRE
Chinese primary meaning.
"""

from __future__ import annotations

import binascii
import hashlib
import json
import re
import struct
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "audio" / "moe"
MANIFEST_PATH = ROOT / "src" / "moe-mandarin-audio.json"
METADATA_URL = (
    "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/"
    "download/dict_concised_2014_20260626.zip"
)
AUDIO_BASE_URL = (
    "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/"
    "download/dict_concised_music_www_2014_20260626.zip"
)
USAGE_NOTICE_URL = (
    "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/"
    "conciseddict_10312.pdf"
)
SOURCE_PAGE = (
    "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/"
    "dict_concised_download.html"
)
SOURCE_VERSION = "2014_20260626"
SPLIT_SIZE = 3_145_728_000
FINAL_PART_SIZE = 2_166_276_890
USER_AGENT = "GRE-roots-MOE-audio-import/1.0"
PRIMARY_PATTERN = re.compile(r"\s*\[(?:類|反|記)\]\s*")
WAV_PATTERN = re.compile(r"/([^/]+)\.wav$")
XML_NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def request_bytes(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"User-Agent": USER_AGENT}
    if byte_range:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response:
        if byte_range and response.status != 206:
            raise RuntimeError(f"Expected HTTP 206 for {url}, got {response.status}")
        return response.read()


def fetch_range(url: str, start: int, end: int) -> bytes:
    return request_bytes(url, (start, end))


def fetch_split_archive(start: int, length: int) -> bytes:
    chunks: list[bytes] = []
    while length > 0:
        part_index = start // SPLIT_SIZE
        local_start = start % SPLIT_SIZE
        part_size = SPLIT_SIZE if part_index < 4 else FINAL_PART_SIZE
        take = min(length, part_size - local_start)
        part_url = f"{AUDIO_BASE_URL}.{part_index + 1:03d}"
        chunks.append(fetch_range(part_url, local_start, local_start + take - 1))
        start += take
        length -= take
    return b"".join(chunks)


def read_primary_meanings() -> set[str]:
    meanings: set[str] = set()
    for relative_path in ("data/vocabulary-1000.json", "data/vocabulary.json"):
        payload = json.loads((ROOT / relative_path).read_text(encoding="utf-8"))
        for word in payload["words"]:
            primary = PRIMARY_PATTERN.split(str(word.get("meaning", "")), maxsplit=1)[0].strip()
            if primary:
                meanings.add(primary)
    return meanings


def shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    with workbook.open("xl/sharedStrings.xml") as handle:
        tree = ET.parse(handle)
    return ["".join(item.itertext()) for item in tree.getroot().findall(f"{XML_NAMESPACE}si")]


def cell_value(cell: ET.Element, strings: list[str]) -> str:
    value = cell.find(f"{XML_NAMESPACE}v")
    if value is None or value.text is None:
        return ""
    if cell.get("t") == "s":
        return strings[int(value.text)]
    return value.text


def read_headword_entries(metadata_archive: bytes) -> dict[str, list[str]]:
    with zipfile.ZipFile(BytesIO(metadata_archive)) as outer:
        workbook_name = next(name for name in outer.namelist() if name.lower().endswith(".xlsx"))
        workbook_bytes = outer.read(workbook_name)

    entries: dict[str, list[str]] = {}
    with zipfile.ZipFile(BytesIO(workbook_bytes)) as workbook:
        strings = shared_strings(workbook)
        with workbook.open("xl/worksheets/sheet1.xml") as sheet:
            for _, row in ET.iterparse(sheet, events=("end",)):
                if row.tag != f"{XML_NAMESPACE}row" or row.get("r") == "1":
                    continue
                values: dict[str, str] = {}
                for cell in row.findall(f"{XML_NAMESPACE}c"):
                    reference = cell.get("r", "")
                    column = re.match(r"[A-Z]+", reference)
                    if column and column.group() in {"A", "B"}:
                        values[column.group()] = cell_value(cell, strings).strip()
                headword = values.get("A", "")
                entry_id = values.get("B", "")
                if headword and entry_id:
                    entries.setdefault(headword, []).append(entry_id)
                row.clear()
    return entries


def zip64_value(extra: bytes, compressed_size: int, uncompressed_size: int, local_offset: int):
    cursor = 0
    while cursor + 4 <= len(extra):
        field_id, field_length = struct.unpack_from("<2H", extra, cursor)
        field = extra[cursor + 4:cursor + 4 + field_length]
        if field_id == 0x0001:
            field_cursor = 0
            if uncompressed_size == 0xFFFFFFFF:
                uncompressed_size = struct.unpack_from("<Q", field, field_cursor)[0]
                field_cursor += 8
            if compressed_size == 0xFFFFFFFF:
                compressed_size = struct.unpack_from("<Q", field, field_cursor)[0]
                field_cursor += 8
            if local_offset == 0xFFFFFFFF:
                local_offset = struct.unpack_from("<Q", field, field_cursor)[0]
            break
        cursor += 4 + field_length
    return compressed_size, uncompressed_size, local_offset


def read_audio_index() -> dict[str, dict[str, int | str]]:
    final_url = f"{AUDIO_BASE_URL}.005"
    tail_start = FINAL_PART_SIZE - 1_048_576
    tail = fetch_range(final_url, tail_start, FINAL_PART_SIZE - 1)
    end_record = tail.rfind(b"PK\x05\x06")
    zip64_record = tail.rfind(b"PK\x06\x06", 0, end_record)
    if end_record < 0 or zip64_record < 0:
        raise RuntimeError("ZIP64 end records were not found")

    unpacked = struct.unpack("<4sQ2H2L4Q", tail[zip64_record:zip64_record + 56])
    central_size = unpacked[8]
    central_offset = unpacked[9]
    central = fetch_split_archive(central_offset, central_size)

    recordings: dict[str, dict[str, int | str]] = {}
    cursor = 0
    while cursor + 46 <= len(central) and central[cursor:cursor + 4] == b"PK\x01\x02":
        flags = struct.unpack_from("<H", central, cursor + 8)[0]
        compression = struct.unpack_from("<H", central, cursor + 10)[0]
        crc32 = struct.unpack_from("<L", central, cursor + 16)[0]
        compressed_size = struct.unpack_from("<L", central, cursor + 20)[0]
        uncompressed_size = struct.unpack_from("<L", central, cursor + 24)[0]
        filename_length, extra_length, comment_length = struct.unpack_from("<3H", central, cursor + 28)
        local_offset = struct.unpack_from("<L", central, cursor + 42)[0]
        raw_name = central[cursor + 46:cursor + 46 + filename_length]
        extra = central[cursor + 46 + filename_length:cursor + 46 + filename_length + extra_length]
        encoding = "utf-8" if flags & 0x800 else "cp437"
        name = raw_name.decode(encoding, errors="replace")
        compressed_size, uncompressed_size, local_offset = zip64_value(
            extra, compressed_size, uncompressed_size, local_offset
        )
        match = WAV_PATTERN.search(name)
        if match:
            recordings[match.group(1)] = {
                "name": name,
                "compression": compression,
                "crc32": crc32,
                "compressedSize": compressed_size,
                "uncompressedSize": uncompressed_size,
                "localOffset": local_offset,
            }
        cursor += 46 + filename_length + extra_length + comment_length
    return recordings


def extract_recording(item: tuple[str, str, dict[str, int | str]]):
    meaning, entry_id, recording = item
    local_offset = int(recording["localOffset"])
    header = fetch_split_archive(local_offset, 30)
    if header[:4] != b"PK\x03\x04":
        raise RuntimeError(f"Local file header not found for {entry_id}")
    filename_length, extra_length = struct.unpack_from("<2H", header, 26)
    data_offset = local_offset + 30 + filename_length + extra_length
    compressed = fetch_split_archive(data_offset, int(recording["compressedSize"]))
    compression = int(recording["compression"])
    if compression == 0:
        wav_bytes = compressed
    elif compression == 8:
        wav_bytes = zlib.decompress(compressed, -15)
    else:
        raise RuntimeError(f"Unsupported compression method {compression} for {entry_id}")
    if len(wav_bytes) != int(recording["uncompressedSize"]):
        raise RuntimeError(f"Size mismatch for {entry_id}")
    if (binascii.crc32(wav_bytes) & 0xFFFFFFFF) != int(recording["crc32"]):
        raise RuntimeError(f"CRC mismatch for {entry_id}")
    return meaning, entry_id, wav_bytes


def main() -> None:
    meanings = read_primary_meanings()
    metadata_archive = request_bytes(METADATA_URL)
    headword_entries = read_headword_entries(metadata_archive)
    audio_index = read_audio_index()

    selected: list[tuple[str, str, dict[str, int | str]]] = []
    for meaning in sorted(meanings.intersection(headword_entries)):
        entry_id = next((candidate for candidate in headword_entries[meaning] if candidate in audio_index), None)
        if entry_id:
            selected.append((meaning, entry_id, audio_index[entry_id]))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    recordings: dict[str, dict[str, str | int]] = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        for meaning, entry_id, wav_bytes in executor.map(extract_recording, selected):
            output_path = OUTPUT_DIR / f"{entry_id}.wav"
            output_path.write_bytes(wav_bytes)
            recordings[meaning] = {
                "entryId": entry_id,
                "url": f"/audio/moe/{entry_id}.wav",
                "bytes": len(wav_bytes),
                "sha256": hashlib.sha256(wav_bytes).hexdigest(),
            }

    selected_ids = {entry_id for _, entry_id, _ in selected}
    for stale_path in OUTPUT_DIR.glob("*.wav"):
        if stale_path.stem not in selected_ids:
            stale_path.unlink()

    usage_notice = request_bytes(USAGE_NOTICE_URL)
    (OUTPUT_DIR / "conciseddict_10312.pdf").write_bytes(usage_notice)
    source_record = {
        "title": "中華民國教育部《國語辭典簡編本》",
        "sourceVersion": SOURCE_VERSION,
        "sourcePage": SOURCE_PAGE,
        "usageNotice": "/audio/moe/conciseddict_10312.pdf",
        "license": "CC BY-ND 3.0 TW",
        "note": "詞目全文聲音檔；原始 WAV 未修改。",
        "recordingCount": len(recordings),
        "recordings": dict(sorted(recordings.items())),
    }
    MANIFEST_PATH.write_text(json.dumps(source_record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUTPUT_DIR / "source.json").write_text(
        json.dumps({key: value for key, value in source_record.items() if key != "recordings"}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Imported {len(recordings)} unmodified MOE recordings for {len(meanings)} GRE meanings.")


if __name__ == "__main__":
    main()
