"""End-to-end crawl over a local http.server.

Hermetic and stdlib-only -- no internet. Exercises the real CrawlerEngine,
Scheduler, LinkExtractor, depth propagation over an actual HTTP round trip,
and extract_content.
"""

import asyncio
import http.server
import threading
from urllib.parse import urlparse

import orjson
import pytest

import crawl_db
from crawl_jobs import JobManager
from crawler import CrawlConfig, DashboardSpider

PAGES = {
    "index.html": b"""<html><head><title>Index</title></head><body>
        <p>root page</p><a href="a.html">A</a><a href="b.html">B</a>
        <a href="deep.html">Deep</a></body></html>""",
    "a.html": b"<html><head><title>A</title></head><body><p>page a</p></body></html>",
    "b.html": b"<html><head><title>B</title></head><body><p>page b</p></body></html>",
    "deep.html": b"<html><head><title>Deep</title></head><body><p>deep</p></body></html>",
}


def _wide_page(n: int) -> bytes:
    """A page in a synthetic, effectively unbounded site: /w/N.html links onward.

    Needed so the stop/shutdown tests have a crawl long enough to interrupt.
    """
    links = "".join(f'<a href="/w/{n * 4 + i}.html">L{i}</a>' for i in range(1, 5))
    return f"<html><head><title>W{n}</title></head><body><p>wide {n}</p>{links}</body></html>".encode()


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib naming
        name = self.path.lstrip("/").split("?")[0] or "index.html"
        if name == "forbidden.html":
            # 403 is in the engine's BLOCKED_CODES, so this is retried and then
            # abandoned -- the shape of a site that refuses every request.
            self.send_error(403)
            return
        if name.startswith("w/") and name.endswith(".html"):
            try:
                body = _wide_page(int(name[2:-5]))
            except ValueError:
                self.send_error(404)
                return
        else:
            body = PAGES.get(name)
        if body is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass  # keep pytest output clean


@pytest.fixture
def site():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def make_config(base, **overrides):
    opts = dict(
        job_id="e2e",
        name="e2e",
        start_urls=(f"{base}/index.html",),
        mode="static",
        max_depth=1,
        max_items=10,
        # netloc form (host:port), matching what crawl_api derives from start_urls
        allowed_domains=frozenset({urlparse(base).netloc}),
        extraction_type="text",
        max_content_chars=0,
        concurrent_requests=2,
        robots_txt_obey=False,
    )
    opts.update(overrides)
    return CrawlConfig(**opts)


@pytest.mark.anyio
async def test_local_site_crawl_yields_all_pages_with_depths(temp_db, site):
    spider = DashboardSpider(make_config(site))
    items = [item async for item in spider.stream()]

    assert len(items) == 4
    assert {urlparse(i["url"]).path for i in items} == {
        "/index.html",
        "/a.html",
        "/b.html",
        "/deep.html",
    }
    by_path = {urlparse(i["url"]).path: i for i in items}
    assert by_path["/index.html"]["depth"] == 0
    assert by_path["/a.html"]["depth"] == 1
    assert by_path["/deep.html"]["depth"] == 1
    assert all(i["status_code"] == 200 for i in items)
    assert "page a" in by_path["/a.html"]["content"]


@pytest.mark.anyio
async def test_max_depth_zero_fetches_only_the_seed(temp_db, site):
    spider = DashboardSpider(make_config(site, max_depth=0))
    items = [item async for item in spider.stream()]
    assert [urlparse(i["url"]).path for i in items] == ["/index.html"]


@pytest.mark.anyio
async def test_max_items_cap_terminates_the_stream(temp_db, site):
    spider = DashboardSpider(make_config(site, max_items=1))
    items = [item async for item in spider.stream()]
    assert len(items) == 1


@pytest.mark.anyio
async def test_deny_patterns_filter_followed_links(temp_db, site):
    spider = DashboardSpider(make_config(site, deny_patterns=(r"deep\.html",)))
    items = [item async for item in spider.stream()]
    assert "/deep.html" not in {urlparse(i["url"]).path for i in items}
    assert len(items) == 3


@pytest.mark.anyio
async def test_job_manager_runs_a_job_and_persists_items(temp_db, site):
    config = make_config(site, job_id="managed")
    crawl_db.create_job("managed", "Managed", "static", "{}")

    manager = JobManager()
    manager.submit(config)
    rj = manager.get("managed")
    assert rj is not None
    await rj.task

    job = crawl_db.get_job("managed")
    assert job["status"] == "completed"
    assert job["error"] is None
    assert job["items_count"] == 4
    assert job["started_at"] and job["finished_at"]
    assert crawl_db.count_items("managed") == 4

    # The negative-elapsed fix: CrawlStats.end_time is 0 for the whole run, so an
    # uncorrected to_dict() would persist a hugely negative elapsed/rps here.
    stats = orjson.loads(job["stats_json"])
    assert stats["items_scraped"] == 4
    assert stats["requests_count"] == 4
    assert stats["elapsed_seconds"] > 0
    assert stats["requests_per_second"] > 0
    assert stats["failed_requests_count"] == 0
    assert stats["response_status_count"] == {"status_200": 4}

    # Finished jobs are dropped from the live registry.
    assert manager.get("managed") is None


@pytest.mark.anyio
async def test_capturing_nothing_is_reported_as_failed_with_a_reason(temp_db, site):
    """A crawl that captures zero pages must not show a green 'completed'.

    Reproduces the real-world case: the site answers 403 to everything, the engine
    retries and gives up, and the job ends with nothing to show.
    """
    config = make_config(
        site,
        job_id="nothing",
        start_urls=(f"{site}/forbidden.html",),
        max_depth=1,
        max_items=10,
    )
    crawl_db.create_job("nothing", "Nothing", "static", "{}")

    manager = JobManager()
    manager.submit(config)
    await manager.get("nothing").task

    job = crawl_db.get_job("nothing")
    assert job["items_count"] == 0
    assert job["status"] == "failed"  # not a green 'completed'
    # ...and the reason names what happened and what to try
    assert "refused every request" in job["error"]
    assert "403" in job["error"]


@pytest.mark.anyio
async def test_stop_ends_the_job_and_keeps_scraped_items(temp_db, site):
    # A slow, deep crawl so there is something to interrupt.
    config = make_config(
        site,
        job_id="stopme",
        start_urls=(f"{site}/w/1.html",),
        max_depth=6,
        max_items=500,
        download_delay=0.2,
    )
    crawl_db.create_job("stopme", "Stop Me", "static", "{}")

    manager = JobManager()
    manager.submit(config)
    await asyncio.sleep(1.5)
    # Hold the task: _run() pops the job from the registry as it finishes.
    task = manager.get("stopme").task

    assert await manager.stop("stopme") is True
    await asyncio.wait_for(task, timeout=30)

    job = crawl_db.get_job("stopme")
    assert job["status"] == "stopped"
    assert job["finished_at"]
    # Whatever was already scraped survives the stop.
    assert crawl_db.count_items("stopme") >= 1
    assert crawl_db.count_items("stopme") < 500


@pytest.mark.anyio
async def test_shutdown_drains_running_jobs(temp_db, site):
    """The lifespan calls this on the way out; before it existed, jobs (and any
    browser processes they owned) were simply abandoned."""
    config = make_config(
        site, job_id="shutme", max_depth=2, max_items=500, download_delay=0.4
    )
    crawl_db.create_job("shutme", "Shut Me", "static", "{}")

    manager = JobManager()
    manager.submit(config)
    await asyncio.sleep(1.0)
    assert manager.is_live("shutme")

    await asyncio.wait_for(manager.shutdown(), timeout=30)

    assert manager.get("shutme") is None
    assert crawl_db.get_job("shutme")["status"] in ("stopped", "completed")


@pytest.mark.anyio
async def test_job_manager_publishes_events_to_subscribers(temp_db, site):
    config = make_config(site, job_id="evented")
    crawl_db.create_job("evented", "Evented", "static", "{}")

    manager = JobManager()
    manager.submit(config)
    queue = manager.subscribe("evented")
    assert queue is not None

    await manager.get("evented").task

    events = []
    while not queue.empty():
        events.append(queue.get_nowait())

    names = [e[0] for e in events]
    assert "status" in names
    assert names.count("item") == 4
    assert names[-2] == "done"
    assert events[-1] == (None, None)  # sentinel closes the SSE generator

    done_payload = events[-2][1]
    assert done_payload["status"] == "completed"
    assert done_payload["stats"]["items_scraped"] == 4
