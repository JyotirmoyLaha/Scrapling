"""Turns a dashboard crawl form into a runnable Scrapling spider.

Deliberately framework-free (no FastAPI, no Pydantic) so it can be unit-tested
without spinning up the app. crawl_api.py owns the HTTP-facing validation and
converts its Pydantic model into the CrawlConfig dataclass below.
"""

import logging
from urllib.parse import urlparse
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Union

from scrapling.spiders import CrawlRule, CrawlSpider, LinkExtractor, Request, SessionManager

import crawl_db
from content_utils import extract_content


# Below this many characters a page has effectively yielded nothing. Enough slack
# to ignore a stray tracking pixel or a lone nav word.
MIN_MEANINGFUL_CHARS = 50

# Third-party hosts that serve no page content but routinely keep the browser's
# `load` event pending, which is what a page navigation waits on. Blocking them
# measurably shortens slow page loads and prevents some outright timeouts.
TRACKER_DOMAINS = frozenset(
    {
        "google-analytics.com",
        "googletagmanager.com",
        "googlesyndication.com",
        "googleadservices.com",
        "doubleclick.net",
        "adservice.google.com",
        "connect.facebook.net",
        "facebook.net",
        "hotjar.com",
        "hotjar.io",
        "clarity.ms",
        "segment.com",
        "segment.io",
        "mixpanel.com",
        "amplitude.com",
        "intercom.io",
        "crisp.chat",
        "tawk.to",
        "licdn.com",
        "ads-twitter.com",
        "analytics.tiktok.com",
        "snap.licdn.com",
        "newrelic.com",
        "nr-data.net",
        "cloudflareinsights.com",
        "hs-scripts.com",
        "hubspot.com",
        "zdassets.com",
    }
)


def strip_port(domain: str) -> str:
    return domain.rsplit(":", 1)[0] if ":" in domain else domain


@dataclass(frozen=True)
class CrawlConfig:
    job_id: str
    name: str
    start_urls: tuple = ()
    mode: str = "static"  # static | dynamic | stealthy
    max_depth: int = 1  # 0 = seeds only
    max_items: int = 50
    allowed_domains: frozenset = frozenset()
    follow_links: bool = True
    allow_patterns: tuple = ()
    deny_patterns: tuple = ()
    restrict_css: tuple = ()
    css_selector: Optional[str] = None
    extraction_type: str = "markdown"  # markdown | text | html
    max_content_chars: int = 20000
    concurrent_requests: int = 4
    concurrent_requests_per_domain: int = 0
    download_delay: float = 0.0
    # Seconds to allow one page to load. The library default of 30s is too tight for
    # slow sites -- a page that would have finished at 32s is lost entirely -- and a
    # crawl is an unattended background job, so waiting a little longer is cheap.
    page_timeout: int = 45
    block_trackers: bool = True
    robots_txt_obey: bool = True
    headless: bool = True
    solve_cloudflare: bool = False
    # Defaults to True to match the library (StealthConfig.google_search is True):
    # Scrapling sets a Google referer unless told otherwise, and a fair number of
    # WAFs 403 requests that arrive with no referer at all. Passing False here
    # silently opted every crawl out of that.
    google_search: bool = True
    resumable: bool = False
    crawldir: Optional[str] = None


class DashboardSpider(CrawlSpider):
    """A CrawlSpider whose behaviour comes from a CrawlConfig instead of class attributes.

    Spider.__init__ reads `self.name` / `self.start_urls` / etc. as attributes, and
    instance attributes shadow class attributes -- so everything is assigned to self
    *before* calling super().__init__(). No metaclass tricks, no per-job class objects.
    """

    def __init__(self, config: CrawlConfig, *, on_event: Optional[Callable[[str, dict], None]] = None):
        self.config = config
        self.on_event = on_event
        self._emitted = 0
        # Tracked so a crawl that "succeeds" while extracting nothing can say why.
        self._empty_pages = 0
        self._links_found = 0
        self._timeouts = 0
        self._redirected_to: Optional[str] = None

        # --- shadow the base class attributes; must precede super().__init__() ---
        # A per-job logger name keeps two concurrent jobs from sharing a Logger
        # (and therefore from polluting each other's log_levels_counter stats).
        self.name = f"job-{config.job_id}"
        self.start_urls = list(config.start_urls)
        # The engine matches allowed_domains against Request.domain, which is
        # urlparse().netloc and therefore *includes the port*; LinkExtractor matches
        # against urlsplit().hostname, which does *not*. Feeding the same set to both
        # silently drops every followed link on any non-default port. So hold both
        # forms here: with-port for the engine, without-port for the extractor.
        self.allowed_domains = {d for d in config.allowed_domains} | {
            strip_port(d) for d in config.allowed_domains
        }
        self.robots_txt_obey = config.robots_txt_obey
        self.concurrent_requests = config.concurrent_requests
        self.concurrent_requests_per_domain = config.concurrent_requests_per_domain
        self.download_delay = config.download_delay
        self.logging_level = logging.INFO  # the DEBUG default floods the console
        self.log_file = str(crawl_db.job_log_path(config.job_id))

        self._build_link_extractor()

        # 30s checkpoints rather than the 300s default: a dashboard user who stops a
        # job expects to be able to resume near where it stopped.
        super().__init__(crawldir=config.crawldir, interval=30.0)

    def _build_link_extractor(self) -> None:
        c = self.config
        self._link_extractor = LinkExtractor(
            allow=c.allow_patterns,
            deny=c.deny_patterns,
            # LinkExtractor matches hostnames, so strip any port here.
            allow_domains=tuple({strip_port(d) for d in self.allowed_domains}),
            restrict_css=c.restrict_css,
        )

    def _adopt_redirect_target(self, response) -> None:
        """Allow the host a start URL actually redirected to.

        allowed_domains is derived from the URL the user typed. When that URL
        redirects elsewhere -- morth.nic.in to morth.gov.in, example.com to
        www.example.com, http to https -- every link on the landing page belongs to
        the new host and gets discarded as offsite, so the crawl silently stops at
        one page.

        Only start URLs are adopted, so a redirect deeper in the crawl cannot walk
        the crawler onto an unrelated site. `self.allowed_domains` is the same set
        object CrawlerEngine holds, so it is mutated in place, never reassigned.
        """
        landed = urlparse(response.url).netloc
        if not landed:
            return
        host = strip_port(landed)
        if landed in self.allowed_domains or host in self.allowed_domains:
            return
        if any(host == d or host.endswith("." + d) for d in self.allowed_domains):
            return

        self.allowed_domains.add(landed)
        self.allowed_domains.add(host)
        self._build_link_extractor()
        self._redirected_to = host
        self.logger.info(f"Start URL redirected to {host}; adding it to the allowed domains")

    # ---------------------------------------------------------------- sessions

    def configure_sessions(self, manager: SessionManager) -> None:
        """Pick the fetcher backend. Any exception here is wrapped by the library
        into SessionConfigurationError, which crawl_api turns into a 400."""
        c = self.config
        if c.mode == "static":
            from scrapling.fetchers import FetcherSession

            # Static timeouts are in seconds; browser timeouts are in milliseconds.
            manager.add(
                "default",
                FetcherSession(
                    impersonate="chrome",
                    stealthy_headers=True,
                    timeout=c.page_timeout,
                    retries=2,
                ),
            )
            return

        # Browser sessions default to max_pages=1, which would serialize the crawl
        # no matter what concurrent_requests says.
        pages = max(1, min(c.concurrent_requests, 50))
        common = {
            "headless": c.headless,
            "max_pages": pages,
            "google_search": c.google_search,
            "disable_resources": True,
            "timeout": c.page_timeout * 1000,
        }
        if c.block_trackers:
            common["blocked_domains"] = set(TRACKER_DOMAINS)

        if c.mode == "stealthy":
            from scrapling.fetchers import AsyncStealthySession

            manager.add(
                "default",
                AsyncStealthySession(
                    solve_cloudflare=c.solve_cloudflare,
                    network_idle=False,
                    **common,
                ),
            )
        else:
            from scrapling.fetchers import AsyncDynamicSession

            manager.add("default", AsyncDynamicSession(**common))

    # ---------------------------------------------------------------- crawling

    def request_stop(self) -> bool:
        """Ask the engine to shut down gracefully; drains in-flight requests, runs
        on_close(), closes the sessions and ends the item stream.

        Spider.pause() raises if no engine is attached (before the crawl starts, or
        once it has been torn down). Callers here are on the parse() path, where a
        raised RuntimeError would abort the callback and fail an otherwise clean job.
        """
        try:
            self.pause()
            return True
        except RuntimeError:
            return False

    async def start_requests(self) -> AsyncGenerator[Request, None]:
        for url in self.config.start_urls:
            yield Request(
                url,
                sid=self._session_manager.default_session_id,
                meta={"depth": 0},
            )

    def rules(self) -> List[CrawlRule]:
        if not self.config.follow_links or self.config.max_depth <= 0:
            return []
        return [CrawlRule(link_extractor=self._link_extractor)]

    async def parse(self, response) -> AsyncGenerator[Union[Dict[str, Any], Request, None], None]:
        """Emit one item for this page, then the links to follow.

        Overrides CrawlSpider.parse entirely rather than delegating: the base version
        yields only Requests (never items) and calls response.follow() without meta,
        which would drop the depth counter.
        """
        c = self.config
        if self._emitted >= c.max_items:
            return

        depth = int(response.meta.get("depth", 0) or 0)

        # Must happen before links are extracted below, and only for start URLs.
        if depth == 0:
            self._adopt_redirect_target(response)

        content = extract_content(response, c.css_selector, c.extraction_type)
        if c.max_content_chars:
            content = content[: c.max_content_chars]

        title = (response.css("title::text").get() or "").strip() or response.url

        links = []
        if depth < c.max_depth:
            for rule in self.rules():
                links.extend((rule, url) for url in rule.link_extractor.extract(response))

        # Yield the item before the follow-up requests so the SSE stream shows this
        # page immediately rather than after the whole link set is enqueued.
        yield {
            "url": response.url,
            "title": title,
            "content": content,
            "depth": depth,
            "status_code": response.status,
            "content_chars": len(content),
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "extra": {"links_found": len(links)},
        }
        self._emitted += 1
        self._links_found += len(links)
        if self._is_empty(response, content):
            self._empty_pages += 1

        if self._emitted >= c.max_items:
            self.request_stop()
            return

        for rule, url in links:
            req = response.follow(url, callback=rule.callback, meta={"depth": depth + 1})
            if rule.priority is not None:
                req.priority = rule.priority
            if rule.process_request is not None:
                req = rule.process_request(req, response)
            yield req

    def _is_empty(self, response, content: str) -> bool:
        """Did this page actually yield anything readable?

        When the user supplied a selector, the saved content is the thing to judge.
        Otherwise judge the page's own text rather than the formatted output:
        markdownifying an empty JS shell can still emit a stray tracking-pixel
        image, which is a hundred characters of nothing.
        """
        if self.config.css_selector:
            return len(content.strip()) < MIN_MEANINGFUL_CHARS
        try:
            return len(response.get_all_text(strip=True)) < MIN_MEANINGFUL_CHARS
        except Exception:
            return len(content.strip()) < MIN_MEANINGFUL_CHARS

    def _diagnose_nothing_captured(self, stats: Dict[str, Any]) -> str:
        """Explain a crawl that finished without capturing a single page."""
        c = self.config
        blocked = stats.get("blocked_requests_count", 0)
        failed = stats.get("failed_requests_count", 0)
        robots = stats.get("robots_disallowed_count", 0)
        offsite = stats.get("offsite_requests_count", 0)
        codes = sorted(
            k.replace("status_", "") for k in stats.get("response_status_count", {})
        )
        seen = f" (HTTP {', '.join(codes)})" if codes else ""

        if blocked:
            advice = []
            if not c.google_search:
                advice.append("tick 'Spoof Google Referer' (many sites reject requests with no referer)")
            if c.mode == "static":
                advice.append("switch to Stealthy mode")
            elif c.mode == "dynamic":
                advice.append("switch to Stealthy mode, which disguises the browser")
            else:
                if not c.solve_cloudflare:
                    advice.append("tick 'Solve Cloudflare'")
                advice.append("raise Delay to a second or two so you look less automated")
            return (
                f"The site refused every request{seen}, so nothing was captured. "
                f"Try: {'; '.join(advice)}."
            )

        if robots:
            return (
                "Every URL was disallowed by the site's robots.txt, so nothing was crawled. "
                "If this site is yours, untick 'Obey robots.txt'; otherwise the site is asking "
                "not to be crawled."
            )

        if failed:
            return (
                f"Every request failed before a page could be read{seen}. Check the start URL "
                "is reachable, and that you are online."
            )

        if offsite:
            return (
                "Every link found pointed at a different domain and was skipped. Add those "
                "domains to 'Allowed Domains' if you want them crawled."
            )

        return (
            "No pages were captured. Check the start URL is correct and, if you set Allow/Deny "
            "patterns, that they are not excluding everything."
        )

    def extraction_warning(self, stats: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Explain a crawl that technically succeeded but produced nothing useful.

        Two families of failure look like success from the outside:
        capturing nothing at all (blocked, disallowed, unreachable), and capturing
        pages that turn out to be empty -- the classic being a JavaScript-rendered
        site fetched in static mode, which returns 200 and a shell with no text and
        no <a> tags. Either way the user gets a green badge and no idea what to do.
        """
        c = self.config
        if self._emitted == 0:
            return self._diagnose_nothing_captured(stats or {})

        all_empty = self._empty_pages == self._emitted
        no_links = self._links_found == 0 and c.follow_links and c.max_depth > 0

        if all_empty:
            if c.css_selector:
                return (
                    f"Pages loaded but your Content Selector ({c.css_selector!r}) matched nothing, "
                    "so no text was saved. Clear the selector, or check it against the page."
                )
            if c.mode == "static":
                return (
                    "Pages loaded but contained no readable text. This site almost certainly "
                    "renders its content with JavaScript, which Static mode does not run. "
                    "Re-run in Dynamic or Stealthy mode."
                )
            return (
                "Pages loaded but contained no readable text. The site may block automated "
                "browsers, or the content may load only after interaction."
            )

        if no_links:
            if c.mode == "static":
                return (
                    "No links were found to follow, so only your start URLs were crawled. "
                    "This site likely builds its navigation with JavaScript — try Dynamic or "
                    "Stealthy mode to crawl deeper."
                )
            return (
                "No links were found to follow, so only your start URLs were crawled. "
                "Check your Allow/Deny patterns and Allowed Domains if you expected more."
            )

        # Pages are coming through, but a lot are being lost on the way.
        if self._timeouts:
            return (
                f"{self._timeouts} page(s) timed out after {c.page_timeout}s and were skipped. "
                f"This site is slow — raise 'Page Timeout' above {c.page_timeout}s, and lower "
                "Concurrency so fewer pages compete for bandwidth."
            )

        failed = stats.get("failed_requests_count", 0) if stats else 0
        if failed and failed >= self._emitted:
            return (
                f"{failed} request(s) failed while {self._emitted} succeeded. Check the failure "
                "messages above; raising 'Page Timeout' helps if they are timeouts."
            )
        return None

    async def on_error(self, request: Request, error: Exception) -> None:
        text = f"{type(error).__name__}: {error}"
        if "timeout" in text.lower():
            self._timeouts += 1
        if self.on_event:
            # Only the first line: Playwright appends a multi-line navigation call log.
            self.on_event(
                "error_event",
                {"url": request.url, "error": text.splitlines()[0][:200]},
            )
