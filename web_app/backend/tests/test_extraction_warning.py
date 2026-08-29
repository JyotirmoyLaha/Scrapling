"""A crawl can finish 'completed' having extracted nothing at all.

The common cause is a JavaScript-rendered site fetched in static mode: HTTP 200,
a few KB of HTML, but an empty shell with no text and no <a> tags. Without a
diagnosis the user just sees a green badge, 1 page and 0 characters.
"""

import pytest
from scrapling.engines.toolbelt.custom import Response
from scrapling.spiders import Request

from crawler import CrawlConfig, DashboardSpider

# The shape medulance.com actually returns to a static fetch: scripts and meta
# tags only -- no text, no anchors.
SPA_SHELL = b"""<html lang="en"><head><meta charset="utf-8">
<link rel="icon" href="/favicon.png"><script src="/main.js"></script></head>
<body><div id="root"></div><noscript></noscript></body></html>"""

RICH_PAGE = b"""<html><head><title>Real</title></head><body>
<p>This page has a decent amount of genuine readable body text on it.</p>
<a href="/next">Next</a></body></html>"""


def make_config(**overrides):
    base = dict(
        job_id="w1",
        name="warn",
        start_urls=("https://example.com/",),
        mode="static",
        max_depth=1,
        max_items=100,
        allowed_domains=frozenset({"example.com"}),
        extraction_type="text",
        max_content_chars=0,
        robots_txt_obey=False,
    )
    base.update(overrides)
    return CrawlConfig(**base)


def make_response(body, url="https://example.com/", depth=0):
    resp = Response(
        url=url, content=body, status=200, reason="OK",
        cookies={}, headers={}, request_headers={}, encoding="utf-8",
    )
    resp.request = Request(url, sid="default", meta={"depth": depth})
    resp.meta = {"depth": depth}
    return resp


async def drive(spider, response):
    return [out async for out in spider.parse(response)]


# --------------------------------------------------------- nothing captured

BLOCKED_STATS = {
    "blocked_requests_count": 4,
    "response_status_count": {"status_403": 4},
}


def test_all_requests_blocked_is_explained(temp_db):
    spider = DashboardSpider(make_config(mode="stealthy", google_search=True))
    warning = spider.extraction_warning(BLOCKED_STATS)

    assert "refused every request" in warning
    assert "HTTP 403" in warning
    # Already stealthy with a referer, so the advice must move on to other levers.
    assert "switch to Stealthy" not in warning
    assert "Solve Cloudflare" in warning
    assert "Delay" in warning


def test_blocked_without_referer_suggests_the_referer_first(temp_db):
    spider = DashboardSpider(make_config(mode="stealthy", google_search=False))
    warning = spider.extraction_warning(BLOCKED_STATS)
    assert "Spoof Google Referer" in warning


def test_blocked_in_static_mode_suggests_stealthy(temp_db):
    spider = DashboardSpider(make_config(mode="static"))
    warning = spider.extraction_warning(BLOCKED_STATS)
    assert "switch to Stealthy mode" in warning


def test_robots_disallowed_is_explained(temp_db):
    spider = DashboardSpider(make_config())
    warning = spider.extraction_warning({"robots_disallowed_count": 5})
    assert "robots.txt" in warning
    assert "untick" in warning


def test_all_requests_failed_is_explained(temp_db):
    spider = DashboardSpider(make_config())
    warning = spider.extraction_warning({"failed_requests_count": 3})
    assert "failed before a page could be read" in warning


def test_everything_offsite_is_explained(temp_db):
    spider = DashboardSpider(make_config())
    warning = spider.extraction_warning({"offsite_requests_count": 12})
    assert "Allowed Domains" in warning


def test_nothing_captured_with_no_signal_still_explains(temp_db):
    spider = DashboardSpider(make_config())
    warning = spider.extraction_warning({})
    assert "No pages were captured" in warning


# ----------------------------------------------------------------- timeouts

@pytest.mark.anyio
async def test_timeouts_are_counted_and_advised_on(temp_db):
    spider = DashboardSpider(make_config(mode="stealthy", page_timeout=45))
    await drive(spider, make_response(RICH_PAGE))  # one good page, so not "all empty"

    from scrapling.spiders import Request as SpiderRequest

    for url in ("https://example.com/a", "https://example.com/b"):
        await spider.on_error(
            SpiderRequest(url, sid="default"),
            TimeoutError("Page.goto: Timeout 45000ms exceeded.\nCall log:\n - navigating"),
        )

    warning = spider.extraction_warning({"failed_requests_count": 2})
    assert "2 page(s) timed out" in warning
    assert "45s" in warning
    assert "Page Timeout" in warning
    assert "Concurrency" in warning


@pytest.mark.anyio
async def test_error_events_are_single_line(temp_db):
    events = []
    spider = DashboardSpider(
        make_config(), on_event=lambda name, data: events.append((name, data))
    )
    from scrapling.spiders import Request as SpiderRequest

    await spider.on_error(
        SpiderRequest("https://example.com/x", sid="default"),
        TimeoutError("Page.goto: Timeout 30000ms exceeded.\nCall log:\n - navigating to ...\n - more"),
    )

    assert len(events) == 1
    name, data = events[0]
    assert name == "error_event"
    # Playwright appends a multi-line call log; SSE data must stay on one line.
    assert "\n" not in data["error"]
    assert "Timeout 30000ms exceeded." in data["error"]


@pytest.mark.anyio
async def test_no_timeout_warning_when_nothing_timed_out(temp_db):
    spider = DashboardSpider(make_config())
    await drive(spider, make_response(RICH_PAGE))
    assert spider.extraction_warning({"failed_requests_count": 0}) is None


# ------------------------------------------------------------ empty content

@pytest.mark.anyio
async def test_zero_pages_always_produces_a_diagnosis(temp_db):
    # Never None: a crawl with nothing to show must always say why.
    assert DashboardSpider(make_config()).extraction_warning() is not None


@pytest.mark.anyio
async def test_js_site_in_static_mode_is_diagnosed(temp_db):
    spider = DashboardSpider(make_config(mode="static"))
    await drive(spider, make_response(SPA_SHELL))

    warning = spider.extraction_warning()
    assert warning is not None
    assert "JavaScript" in warning
    assert "Dynamic or Stealthy" in warning


@pytest.mark.anyio
async def test_js_site_in_browser_mode_gets_a_different_diagnosis(temp_db):
    spider = DashboardSpider(make_config(mode="stealthy"))
    await drive(spider, make_response(SPA_SHELL))

    warning = spider.extraction_warning()
    assert warning is not None
    # Suggesting a browser mode to someone already using one would be nonsense.
    assert "Dynamic or Stealthy" not in warning
    assert "block" in warning


@pytest.mark.anyio
async def test_selector_that_matches_nothing_is_blamed_first(temp_db):
    spider = DashboardSpider(make_config(css_selector=".does-not-exist"))
    await drive(spider, make_response(RICH_PAGE))

    warning = spider.extraction_warning()
    assert warning is not None
    assert "Content Selector" in warning
    assert ".does-not-exist" in warning
    # The page had plenty of text, so JavaScript is not the explanation here.
    assert "JavaScript" not in warning


@pytest.mark.anyio
async def test_page_with_content_but_no_links_is_diagnosed(temp_db):
    no_links = b"<html><head><title>T</title></head><body><p>%s</p></body></html>" % (b"word " * 40)
    spider = DashboardSpider(make_config(mode="static", max_depth=2))
    await drive(spider, make_response(no_links))

    warning = spider.extraction_warning()
    assert warning is not None
    assert "No links were found" in warning


@pytest.mark.anyio
async def test_healthy_crawl_produces_no_warning(temp_db):
    spider = DashboardSpider(make_config())
    await drive(spider, make_response(RICH_PAGE))
    assert spider.extraction_warning() is None


@pytest.mark.anyio
async def test_no_link_warning_when_depth_is_zero(temp_db):
    # Depth 0 means "don't follow links", so finding none is not a problem.
    spider = DashboardSpider(make_config(max_depth=0))
    await drive(spider, make_response(RICH_PAGE))
    assert spider.extraction_warning() is None


@pytest.mark.anyio
async def test_partial_success_is_not_flagged_as_empty(temp_db):
    spider = DashboardSpider(make_config())
    await drive(spider, make_response(RICH_PAGE))
    await drive(spider, make_response(SPA_SHELL, url="https://example.com/empty", depth=1))

    # One good page out of two: not the all-empty signature.
    warning = spider.extraction_warning()
    assert warning is None or "no readable text" not in warning
