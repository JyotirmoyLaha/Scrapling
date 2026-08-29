import pytest
from scrapling.engines.toolbelt.custom import Response
from scrapling.spiders import Request

from crawler import CrawlConfig, DashboardSpider

HTML = b"""<html><head><title>Seed Page</title></head><body>
  <p>hello world</p>
  <a href="/a">A</a>
  <a href="/b">B</a>
  <a href="https://other.com/x">offsite</a>
  <a href="/skip/me">denied</a>
</body></html>"""


def make_config(**overrides):
    base = dict(
        job_id="t1",
        name="test",
        start_urls=("https://example.com/",),
        mode="static",
        max_depth=1,
        max_items=100,
        allowed_domains=frozenset({"example.com"}),
        follow_links=True,
        deny_patterns=(r"/skip/",),
        extraction_type="text",
        max_content_chars=0,
        concurrent_requests=2,
        robots_txt_obey=False,
    )
    base.update(overrides)
    return CrawlConfig(**base)


def make_response(url="https://example.com/", depth=0, body=HTML):
    resp = Response(
        url=url,
        content=body,
        status=200,
        reason="OK",
        cookies={},
        headers={},
        request_headers={},
        encoding="utf-8",
    )
    # follow() needs a Request attached; the engine normally does this.
    resp.request = Request(url, sid="default", meta={"depth": depth})
    resp.meta = {"depth": depth}
    return resp


async def drive(spider, response):
    items, requests = [], []
    async for out in spider.parse(response):
        (requests if isinstance(out, Request) else items).append(out)
    return items, requests


@pytest.mark.anyio
async def test_parse_yields_item_and_depth_stamped_links(temp_db):
    spider = DashboardSpider(make_config())
    items, requests = await drive(spider, make_response(depth=0))

    assert len(items) == 1
    item = items[0]
    assert item["title"] == "Seed Page"
    assert item["depth"] == 0
    assert item["status_code"] == 200
    assert "hello world" in item["content"]
    assert item["content_chars"] == len(item["content"])

    # offsite (other.com) and denied (/skip/) links are filtered out
    assert sorted(r.url for r in requests) == [
        "https://example.com/a",
        "https://example.com/b",
    ]
    # The whole depth feature rests on this: CrawlSpider.parse omits meta, we don't.
    assert all(r.meta["depth"] == 1 for r in requests)


@pytest.mark.anyio
async def test_parse_stops_following_at_max_depth(temp_db):
    spider = DashboardSpider(make_config(max_depth=1))
    items, requests = await drive(spider, make_response(depth=1))

    assert len(items) == 1
    assert items[0]["depth"] == 1
    assert requests == []


@pytest.mark.anyio
async def test_max_depth_zero_means_seeds_only(temp_db):
    spider = DashboardSpider(make_config(max_depth=0))
    items, requests = await drive(spider, make_response(depth=0))

    assert len(items) == 1
    assert requests == []


@pytest.mark.anyio
async def test_follow_links_disabled_yields_no_requests(temp_db):
    spider = DashboardSpider(make_config(follow_links=False))
    _items, requests = await drive(spider, make_response(depth=0))
    assert requests == []


@pytest.mark.anyio
async def test_allow_patterns_filter_links(temp_db):
    spider = DashboardSpider(make_config(allow_patterns=(r"/a$",), deny_patterns=()))
    _items, requests = await drive(spider, make_response(depth=0))
    assert [r.url for r in requests] == ["https://example.com/a"]


@pytest.mark.anyio
async def test_max_items_cap_pauses_and_emits_nothing_further(temp_db):
    spider = DashboardSpider(make_config(max_items=1))

    items, requests = await drive(spider, make_response(depth=0))
    assert len(items) == 1
    # Hitting the cap short-circuits before any links are yielded.
    assert requests == []

    # A second page arriving from an in-flight request produces nothing.
    items2, requests2 = await drive(spider, make_response(url="https://example.com/a", depth=1))
    assert items2 == [] and requests2 == []


@pytest.mark.anyio
async def test_max_content_chars_truncates(temp_db):
    spider = DashboardSpider(make_config(max_content_chars=5))
    items, _ = await drive(spider, make_response(depth=0))
    assert len(items[0]["content"]) == 5


def test_configure_sessions_static_registers_fetcher_session(temp_db):
    from scrapling.fetchers import FetcherSession

    spider = DashboardSpider(make_config(mode="static"))
    manager = spider._session_manager
    assert len(manager) == 1
    assert isinstance(manager.get(manager.default_session_id), FetcherSession)


def test_browser_timeout_is_milliseconds_and_static_is_seconds(temp_db):
    """Browser sessions take a millisecond timeout, FetcherSession takes seconds --
    passing the wrong unit is a 1000x error in either direction."""
    static = DashboardSpider(make_config(mode="static", page_timeout=45))
    assert static._session_manager.get("default")._default_timeout == 45

    stealthy = DashboardSpider(make_config(mode="stealthy", page_timeout=45))
    assert stealthy._session_manager.get("default")._config.timeout == 45000


def test_block_trackers_toggles_blocked_domains(temp_db):
    from crawler import TRACKER_DOMAINS

    on = DashboardSpider(make_config(mode="stealthy", block_trackers=True))
    blocked = on._session_manager.get("default")._config.blocked_domains
    assert "google-analytics.com" in blocked
    assert len(blocked) == len(TRACKER_DOMAINS)

    off = DashboardSpider(make_config(mode="stealthy", block_trackers=False))
    assert not off._session_manager.get("default")._config.blocked_domains


@pytest.mark.anyio
async def test_start_url_redirect_to_another_host_is_adopted(temp_db):
    """morth.nic.in redirects to morth.gov.in. allowed_domains comes from what the
    user typed, so without this every link on the landing page is discarded as
    offsite and the crawl stops dead at one page."""
    spider = DashboardSpider(
        make_config(
            start_urls=("https://old.example.com/",),
            allowed_domains=frozenset({"old.example.com"}),
        )
    )
    engine_view = spider.allowed_domains  # the engine holds this exact set object

    # The seed lands on a different host after a redirect.
    resp = make_response(url="https://new.example.com/", depth=0)
    _items, requests = await drive(spider, resp)

    assert "new.example.com" in spider.allowed_domains
    assert engine_view is spider.allowed_domains  # mutated in place, not replaced
    assert sorted(r.url for r in requests) == [
        "https://new.example.com/a",
        "https://new.example.com/b",
    ]


@pytest.mark.anyio
async def test_redirect_is_only_adopted_for_start_urls(temp_db):
    """A redirect deeper in the crawl must not walk us onto an unrelated site."""
    spider = DashboardSpider(make_config(max_depth=3))
    await drive(spider, make_response(url="https://elsewhere.com/x", depth=2))
    assert "elsewhere.com" not in spider.allowed_domains


@pytest.mark.anyio
async def test_subdomain_landing_does_not_widen_the_scope(temp_db):
    """www.example.com is already covered by example.com; adding it would be noise."""
    spider = DashboardSpider(
        make_config(
            start_urls=("https://example.com/",),
            allowed_domains=frozenset({"example.com"}),
        )
    )
    await drive(spider, make_response(url="https://www.example.com/", depth=0))
    assert spider.allowed_domains == {"example.com"}


def test_unique_logger_per_job(temp_db):
    a = DashboardSpider(make_config(job_id="aaa"))
    b = DashboardSpider(make_config(job_id="bbb"))
    assert a.logger is not b.logger
    assert a.logger.name == "scrapling.spiders.job-aaa"


def test_config_drives_spider_attributes(temp_db):
    spider = DashboardSpider(
        make_config(concurrent_requests=7, download_delay=1.5, robots_txt_obey=True)
    )
    assert spider.concurrent_requests == 7
    assert spider.download_delay == 1.5
    assert spider.robots_txt_obey is True
    assert spider.start_urls == ["https://example.com/"]
    assert spider.allowed_domains == {"example.com"}
