"""Streaming exporters for crawl results.

Deliberately not using ItemList.to_json()/.to_jsonl() from scrapling.spiders.result:
those write a file from an already-in-memory list, whereas our items live in SQLite
and a large crawl should never have to be materialised all at once. These stream
straight off a cursor via crawl_db.iter_items().

All four are *sync* generators on purpose -- StreamingResponse runs those in a
threadpool, which keeps the blocking sqlite cursor off the event loop for free.
"""

import csv
import io
import re
from typing import Iterator

import orjson

import crawl_db

FORMATS = ("json", "jsonl", "csv", "markdown")

EXTENSIONS = {"json": "json", "jsonl": "jsonl", "csv": "csv", "markdown": "md"}

MEDIA_TYPES = {
    "json": "application/json",
    "jsonl": "application/x-ndjson",
    "csv": "text/csv; charset=utf-8",
    "markdown": "text/markdown; charset=utf-8",
}

CSV_COLUMNS = ("id", "url", "title", "depth", "status_code", "content_chars", "timestamp", "content")


def slugify(name: str, fallback: str = "crawl") -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip()).strip("-").lower()
    return (slug or fallback)[:60]


def filename(job_id: str, name: str, fmt: str) -> str:
    return f"crawl-{slugify(name)}-{job_id}.{EXTENSIONS[fmt]}"


def _row(item: dict) -> dict:
    return {
        "id": item["id"],
        "url": item["url"],
        "title": item["title"],
        "depth": item["depth"],
        "status_code": item["status_code"],
        "content_chars": item["content_chars"],
        "timestamp": item["timestamp"],
        "content": item["content"] or "",
        "extra": orjson.loads(item.get("extra_json") or "{}"),
    }


def iter_json(job_id: str) -> Iterator[bytes]:
    yield b"[\n"
    first = True
    for item in crawl_db.iter_items(job_id):
        prefix = b"" if first else b",\n"
        first = False
        yield prefix + orjson.dumps(_row(item), option=orjson.OPT_INDENT_2)
    yield b"\n]\n"


def iter_jsonl(job_id: str) -> Iterator[bytes]:
    for item in crawl_db.iter_items(job_id):
        yield orjson.dumps(_row(item)) + b"\n"


def iter_csv(job_id: str) -> Iterator[bytes]:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")

    def drain() -> bytes:
        value = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        return value.encode("utf-8")

    # BOM so Excel on Windows detects UTF-8 instead of the system codepage.
    yield b"\xef\xbb\xbf"
    writer.writerow(CSV_COLUMNS)
    yield drain()

    for item in crawl_db.iter_items(job_id):
        row = _row(item)
        writer.writerow([row[c] for c in CSV_COLUMNS])
        yield drain()


def iter_markdown(job_id: str) -> Iterator[bytes]:
    for item in crawl_db.iter_items(job_id):
        row = _row(item)
        chunk = (
            f"# {row['title'] or row['url']}\n\n"
            f"<{row['url']}>\n\n"
            f"_depth {row['depth']} · {row['timestamp']} · {row['content_chars']} chars_\n\n"
            f"{row['content']}\n\n---\n\n"
        )
        yield chunk.encode("utf-8")


ITERATORS = {
    "json": iter_json,
    "jsonl": iter_jsonl,
    "csv": iter_csv,
    "markdown": iter_markdown,
}


def stream(job_id: str, fmt: str) -> Iterator[bytes]:
    if fmt not in ITERATORS:
        raise ValueError(f"Unsupported export format: {fmt}")
    return ITERATORS[fmt](job_id)
