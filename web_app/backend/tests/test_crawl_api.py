"""HTTP-level tests for /api/crawl/*.

Uses the router in isolation rather than the full main.py app: main.py builds LLM
clients and reads .env at import time, which has nothing to do with these routes.
"""

import csv
import io

import orjson
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import crawl_db
from crawl_api import router


@pytest.fixture
def client(temp_db):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def _seed_job(job_id="seed", name="Seeded", items=3, status="completed"):
    crawl_db.create_job(
        job_id, name, "static", orjson.dumps({
            "start_urls": ["https://example.com/"],
            "max_depth": 1, "max_items": 50, "extraction_type": "markdown",
        }).decode()
    )
    crawl_db.insert_items(job_id, [
        {
            "url": f"https://example.com/p{i}",
            "title": f"Page {i}",
            "content": f"content of page {i}",
            "depth": i % 2,
            "status_code": 200,
            "content_chars": len(f"content of page {i}"),
            "timestamp": "2026-08-10 12:00:00",
        }
        for i in range(items)
    ])
    crawl_db.update_job_stats(job_id, orjson.dumps({"items_scraped": items}).decode(), items)
    crawl_db.set_job_status(job_id, status, finished_at="2026-08-10 12:01:00")


# ------------------------------------------------------------------ validation

def test_create_rejects_invalid_regex(client):
    resp = client.post("/api/crawl", json={
        "start_urls": ["https://example.com"], "deny_patterns": ["["],
    })
    assert resp.status_code == 422
    assert "Invalid regex" in resp.text
    # no job row is left behind by a rejected config
    assert crawl_db.list_jobs() == []


def test_create_rejects_bad_scheme(client):
    resp = client.post("/api/crawl", json={"start_urls": ["ftp://example.com"]})
    assert resp.status_code == 422
    assert "Invalid URL" in resp.text


def test_create_rejects_empty_start_urls(client):
    assert client.post("/api/crawl", json={"start_urls": []}).status_code == 422
    assert client.post("/api/crawl", json={"start_urls": ["   "]}).status_code == 422


def test_create_enforces_bounds(client):
    resp = client.post("/api/crawl", json={
        "start_urls": ["https://example.com"], "max_depth": 99,
    })
    assert resp.status_code == 422


def test_config_model_derives_netloc_domains_and_normalises_urls():
    from crawl_api import CrawlConfigModel

    model = CrawlConfigModel(start_urls=["example.com/a", "http://localhost:3000/x"])
    assert model.start_urls == ["https://example.com/a", "http://localhost:3000/x"]
    # netloc, with port -- the engine matches Request.domain, which includes it
    assert model.allowed_domains == ["example.com", "localhost:3000"]


def test_config_model_forces_solve_cloudflare_off_outside_stealthy():
    from crawl_api import CrawlConfigModel

    assert CrawlConfigModel(
        start_urls=["https://e.com"], mode="static", solve_cloudflare=True
    ).solve_cloudflare is False
    assert CrawlConfigModel(
        start_urls=["https://e.com"], mode="stealthy", solve_cloudflare=True
    ).solve_cloudflare is True


# ----------------------------------------------------------------- job reading

def test_list_and_get_job(client):
    _seed_job()
    listing = client.get("/api/crawl").json()
    assert len(listing) == 1
    assert listing[0]["id"] == "seed"
    assert listing[0]["items_count"] == 3
    assert listing[0]["live"] is False
    assert listing[0]["start_urls"] == ["https://example.com/"]

    detail = client.get("/api/crawl/seed").json()
    assert detail["status"] == "completed"
    assert detail["stats"]["items_scraped"] == 3
    assert detail["config"]["max_depth"] == 1


def test_get_unknown_job_is_404(client):
    assert client.get("/api/crawl/nope").status_code == 404
    assert client.get("/api/crawl/nope/items").status_code == 404
    assert client.post("/api/crawl/nope/stop").status_code == 404
    assert client.delete("/api/crawl/nope").status_code == 404


def test_items_pagination_and_content_withholding(client):
    _seed_job(items=5)
    page = client.get("/api/crawl/seed/items?limit=2&offset=1").json()
    assert page["total"] == 5
    assert len(page["items"]) == 2
    assert page["items"][0]["url"] == "https://example.com/p1"
    assert all(i["content"] is None for i in page["items"])

    full = client.get("/api/crawl/seed/items?limit=1&include_content=true").json()
    assert full["items"][0]["content"] == "content of page 0"


def test_stop_on_finished_job_is_409(client):
    _seed_job()
    assert client.post("/api/crawl/seed/stop").status_code == 409


def test_delete_removes_job_and_items(client):
    _seed_job()
    assert client.delete("/api/crawl/seed").status_code == 200
    assert client.get("/api/crawl/seed").status_code == 404
    assert crawl_db.count_items("seed") == 0


# --------------------------------------------------------------------- exports

def test_export_json(client):
    _seed_job(items=2)
    resp = client.get("/api/crawl/seed/export?format=json")
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    assert "crawl-seeded-seed.json" in resp.headers["content-disposition"]
    rows = orjson.loads(resp.content)
    assert len(rows) == 2
    assert rows[0]["url"] == "https://example.com/p0"
    assert rows[0]["content"] == "content of page 0"


def test_export_jsonl(client):
    _seed_job(items=3)
    resp = client.get("/api/crawl/seed/export?format=jsonl")
    lines = [line for line in resp.content.decode().splitlines() if line]
    assert len(lines) == 3
    assert orjson.loads(lines[2])["title"] == "Page 2"


def test_export_csv_has_bom_and_rows(client):
    _seed_job(items=2)
    resp = client.get("/api/crawl/seed/export?format=csv")
    raw = resp.content
    # BOM so Excel on Windows reads it as UTF-8
    assert raw.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert rows[0] == list(__import__("crawl_export").CSV_COLUMNS)
    assert len(rows) == 3  # header + 2
    assert rows[1][1] == "https://example.com/p0"


def test_export_markdown(client):
    _seed_job(items=1)
    body = client.get("/api/crawl/seed/export?format=markdown").content.decode()
    assert body.startswith("# Page 0")
    assert "<https://example.com/p0>" in body
    assert "content of page 0" in body


def test_export_rejects_unknown_format(client):
    _seed_job()
    assert client.get("/api/crawl/seed/export?format=xml").status_code == 422


# --------------------------------------------------------------------- library

def test_to_library_saves_all_items(client):
    _seed_job(items=3)
    resp = client.post("/api/crawl/seed/to-library", json={})
    assert resp.json()["saved"] == 3

    import database
    saved = database.get_scrapes()
    assert len(saved) == 3
    assert {s["url"] for s in saved} == {
        "https://example.com/p0", "https://example.com/p1", "https://example.com/p2",
    }
    assert saved[0]["extraction_type"] == "markdown"


def test_to_library_respects_item_ids_and_cap(client):
    _seed_job(items=4)
    ids = [i["id"] for i in crawl_db.get_items("seed", limit=10)]

    assert client.post("/api/crawl/seed/to-library", json={"item_ids": ids[:2]}).json()["saved"] == 2

    import database
    assert len(database.get_scrapes()) == 2

    assert client.post("/api/crawl/seed/to-library", json={"max_items": 1}).json()["saved"] == 1


# ------------------------------------------------------------------------- SSE

def test_stream_of_finished_job_emits_snapshot_then_done(client):
    _seed_job(items=2)
    with client.stream("GET", "/api/crawl/seed/stream") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        assert resp.headers["cache-control"] == "no-cache"
        body = "".join(resp.iter_text())

    assert "event: snapshot" in body
    assert "event: done" in body
    # snapshot must come first
    assert body.index("event: snapshot") < body.index("event: done")

    done_line = [
        line for line in body.splitlines()
        if line.startswith("data:") and '"status"' in line
    ][-1]
    payload = orjson.loads(done_line[len("data:"):].strip())
    assert payload["status"] == "completed"


def test_stream_of_unknown_job_is_404(client):
    assert client.get("/api/crawl/nope/stream").status_code == 404
