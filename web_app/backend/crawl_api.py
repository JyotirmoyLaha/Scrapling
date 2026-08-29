"""HTTP surface for the crawl engine: /api/crawl/*"""

import asyncio
import re
import uuid
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlparse

import orjson
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from scrapling.spiders import SessionConfigurationError

import crawl_db
import crawl_export
import database
from crawl_jobs import job_manager
from crawler import CrawlConfig

router = APIRouter(prefix="/api/crawl", tags=["crawl"])

SSE_HEARTBEAT_SECS = 15


# --------------------------------------------------------------------- models

class CrawlConfigModel(BaseModel):
    name: str = "Untitled Crawl"
    start_urls: List[str] = Field(..., min_length=1, max_length=50)
    mode: Literal["static", "dynamic", "stealthy"] = "static"
    max_depth: int = Field(1, ge=0, le=10)
    max_items: int = Field(50, ge=1, le=5000)
    allowed_domains: List[str] = []  # empty => derived from start_urls
    follow_links: bool = True
    allow_patterns: List[str] = []
    deny_patterns: List[str] = []
    restrict_css: List[str] = []
    css_selector: Optional[str] = None
    extraction_type: Literal["markdown", "text", "html"] = "markdown"
    max_content_chars: int = Field(20000, ge=0, le=200000)
    concurrent_requests: int = Field(4, ge=1, le=16)
    concurrent_requests_per_domain: int = Field(0, ge=0, le=16)
    download_delay: float = Field(0.0, ge=0.0, le=60.0)
    page_timeout: int = Field(45, ge=5, le=300)  # seconds per page
    block_trackers: bool = True
    robots_txt_obey: bool = True
    headless: bool = True
    solve_cloudflare: bool = False
    # True to match the library default; see CrawlConfig.google_search.
    google_search: bool = True
    resumable: bool = False

    @field_validator("start_urls", mode="after")
    @classmethod
    def _normalise_urls(cls, value: List[str]) -> List[str]:
        out = []
        for raw in value:
            url = (raw or "").strip()
            if not url:
                continue
            if "://" not in url:
                url = "https://" + url
            parts = urlparse(url)
            if parts.scheme not in ("http", "https") or not parts.netloc:
                raise ValueError(f"Invalid URL: {raw}")
            out.append(url)
        if not out:
            raise ValueError("At least one valid start URL is required")
        return out

    @field_validator("allow_patterns", "deny_patterns", mode="after")
    @classmethod
    def _compilable(cls, value: List[str]) -> List[str]:
        # Compile here so a bad regex is a clean 422 instead of a job that dies
        # 200ms after it starts.
        for pattern in value:
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"Invalid regex {pattern!r}: {exc}") from exc
        return [p for p in value if p]

    @model_validator(mode="after")
    def _derive(self):
        if not self.allowed_domains:
            # netloc, not hostname: the crawl engine matches Request.domain, which
            # includes the port. crawler.DashboardSpider derives the port-stripped
            # form for the link extractor.
            self.allowed_domains = sorted(
                {urlparse(u).netloc for u in self.start_urls} - {""}
            )
        if self.mode != "stealthy":
            self.solve_cloudflare = False
        return self


class CrawlJobSummary(BaseModel):
    id: str
    name: str
    status: str
    mode: str
    start_urls: List[str] = []
    items_count: int = 0
    max_depth: int = 0
    max_items: int = 0
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None
    live: bool = False


class CrawlJobDetail(CrawlJobSummary):
    config: Dict[str, Any] = {}
    stats: Dict[str, Any] = {}


class CrawlItemModel(BaseModel):
    id: int
    job_id: str
    url: str
    title: Optional[str] = None
    content: Optional[str] = None
    depth: int = 0
    status_code: Optional[int] = None
    content_chars: int = 0
    timestamp: str


class CrawlItemsPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[CrawlItemModel]


class CrawlCreateResponse(BaseModel):
    job_id: str
    status: str


class SendToLibraryRequest(BaseModel):
    item_ids: Optional[List[int]] = None  # None => every item in the job
    max_items: int = Field(100, ge=1, le=1000)


class SendToLibraryResponse(BaseModel):
    saved: int


# -------------------------------------------------------------------- helpers

def _config_of(job_row: dict) -> Dict[str, Any]:
    try:
        return orjson.loads(job_row["config_json"] or "{}")
    except orjson.JSONDecodeError:
        return {}


def _summary(job_row: dict) -> CrawlJobSummary:
    config = _config_of(job_row)
    return CrawlJobSummary(
        id=job_row["id"],
        name=job_row["name"],
        status=job_row["status"],
        mode=job_row["mode"],
        start_urls=config.get("start_urls", []),
        items_count=job_row["items_count"],
        max_depth=config.get("max_depth", 0),
        max_items=config.get("max_items", 0),
        created_at=job_row["created_at"],
        started_at=job_row["started_at"],
        finished_at=job_row["finished_at"],
        error=job_row["error"],
        live=job_manager.is_live(job_row["id"]),
    )


def _detail(job_row: dict) -> CrawlJobDetail:
    job_id = job_row["id"]
    live = job_manager.is_live(job_id)
    if live:
        stats = job_manager.live_stats(job_id)
    else:
        try:
            stats = orjson.loads(job_row["stats_json"] or "{}")
        except orjson.JSONDecodeError:
            stats = {}
    return CrawlJobDetail(**_summary(job_row).model_dump(), config=_config_of(job_row), stats=stats)


def _require_job(job_id: str) -> dict:
    job = crawl_db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Crawl job not found")
    return job


def _to_crawl_config(job_id: str, model: CrawlConfigModel) -> CrawlConfig:
    crawldir = str(crawl_db.job_dir(job_id)) if model.resumable else None
    return CrawlConfig(
        job_id=job_id,
        name=model.name,
        start_urls=tuple(model.start_urls),
        mode=model.mode,
        max_depth=model.max_depth,
        max_items=model.max_items,
        allowed_domains=frozenset(model.allowed_domains),
        follow_links=model.follow_links,
        allow_patterns=tuple(model.allow_patterns),
        deny_patterns=tuple(model.deny_patterns),
        restrict_css=tuple(model.restrict_css),
        css_selector=model.css_selector or None,
        extraction_type=model.extraction_type,
        max_content_chars=model.max_content_chars,
        concurrent_requests=model.concurrent_requests,
        concurrent_requests_per_domain=model.concurrent_requests_per_domain,
        download_delay=model.download_delay,
        page_timeout=model.page_timeout,
        block_trackers=model.block_trackers,
        robots_txt_obey=model.robots_txt_obey,
        headless=model.headless,
        solve_cloudflare=model.solve_cloudflare,
        google_search=model.google_search,
        resumable=model.resumable,
        crawldir=crawldir,
    )


# --------------------------------------------------------------------- routes

@router.post("", response_model=CrawlCreateResponse, status_code=201)
async def create_crawl(config: CrawlConfigModel) -> CrawlCreateResponse:
    job_id = uuid.uuid4().hex[:12]
    crawl_config = _to_crawl_config(job_id, config)

    await asyncio.to_thread(
        crawl_db.create_job, job_id, config.name, config.mode, config.model_dump_json()
    )
    try:
        # submit() builds the spider eagerly, so a bad session config surfaces here
        # as a 400 rather than as a job that fails immediately after returning 201.
        job_manager.submit(crawl_config)
    except SessionConfigurationError as exc:
        await asyncio.to_thread(
            crawl_db.set_job_status, job_id, "failed",
            finished_at=crawl_db.now_ts(), error=str(exc),
        )
        raise HTTPException(status_code=400, detail=f"Session configuration failed: {exc}") from exc
    except (ValueError, TypeError) as exc:
        await asyncio.to_thread(
            crawl_db.set_job_status, job_id, "failed",
            finished_at=crawl_db.now_ts(), error=str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return CrawlCreateResponse(job_id=job_id, status="queued")


@router.get("", response_model=List[CrawlJobSummary])
async def list_crawls(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
) -> List[CrawlJobSummary]:
    rows = await asyncio.to_thread(crawl_db.list_jobs, status, limit)
    return [_summary(r) for r in rows]


@router.get("/{job_id}", response_model=CrawlJobDetail)
async def get_crawl(job_id: str) -> CrawlJobDetail:
    return _detail(_require_job(job_id))


@router.get("/{job_id}/items", response_model=CrawlItemsPage)
async def get_crawl_items(
    job_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_content: bool = Query(False),
) -> CrawlItemsPage:
    _require_job(job_id)
    total = await asyncio.to_thread(crawl_db.count_items, job_id)
    rows = await asyncio.to_thread(crawl_db.get_items, job_id, limit, offset, include_content)
    return CrawlItemsPage(
        total=total,
        limit=limit,
        offset=offset,
        items=[CrawlItemModel(**r) for r in rows],
    )


@router.post("/{job_id}/stop")
async def stop_crawl(job_id: str) -> Dict[str, Any]:
    _require_job(job_id)
    if not await job_manager.stop(job_id):
        raise HTTPException(status_code=409, detail="Crawl job is not running")
    return {"job_id": job_id, "stopping": True}


@router.delete("/{job_id}")
async def delete_crawl(job_id: str) -> Dict[str, Any]:
    _require_job(job_id)
    if job_manager.is_live(job_id):
        raise HTTPException(status_code=409, detail="Stop the crawl job before deleting it")
    await asyncio.to_thread(crawl_db.delete_job, job_id)
    return {"job_id": job_id, "deleted": True}


@router.get("/{job_id}/export")
async def export_crawl(
    job_id: str,
    format: Literal["json", "jsonl", "csv", "markdown"] = Query("json"),
) -> StreamingResponse:
    job = _require_job(job_id)
    name = crawl_export.filename(job_id, job["name"], format)
    return StreamingResponse(
        crawl_export.stream(job_id, format),
        media_type=crawl_export.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/{job_id}/to-library", response_model=SendToLibraryResponse)
async def send_to_library(job_id: str, payload: SendToLibraryRequest) -> SendToLibraryResponse:
    job = _require_job(job_id)
    config = _config_of(job)
    extraction_type = config.get("extraction_type", "markdown")
    wanted = set(payload.item_ids) if payload.item_ids else None

    def _save() -> int:
        saved = 0
        for item in crawl_db.iter_items(job_id):
            if wanted is not None and item["id"] not in wanted:
                continue
            if saved >= payload.max_items:
                break
            # The same helper /api/scrape uses, so crawl output lands in the existing
            # Research Library with no schema change.
            database.save_scrape(
                item["url"], item["title"], item["content"], extraction_type
            )
            saved += 1
        return saved

    return SendToLibraryResponse(saved=await asyncio.to_thread(_save))


# ------------------------------------------------------------------------ SSE

def _sse(event: str, data: Any) -> str:
    # orjson without OPT_INDENT_2 is guaranteed single-line, which is what keeps
    # the SSE framing valid without escaping embedded newlines.
    return f"event: {event}\ndata: {orjson.dumps(data).decode()}\n\n"


@router.get("/{job_id}/stream")
async def stream_crawl(job_id: str, request: Request) -> StreamingResponse:
    job = _require_job(job_id)

    async def generator():
        detail = _detail(job)
        recent = []
        rj = job_manager.get(job_id)
        if rj is not None:
            recent = list(rj.recent_items)
        yield _sse(
            "snapshot",
            {"job": detail.model_dump(), "stats": detail.stats, "recent_items": recent},
        )

        if rj is None:
            # Already finished before the client connected.
            yield _sse(
                "done",
                {"status": job["status"], "error": job["error"], "stats": detail.stats},
            )
            return

        queue = job_manager.subscribe(job_id)
        if queue is None:
            yield _sse("done", {"status": job["status"], "error": job["error"], "stats": detail.stats})
            return

        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=SSE_HEARTBEAT_SECS)
                except asyncio.TimeoutError:
                    # Doubles as heartbeat and as the disconnect-detection tick.
                    yield ": ping\n\n"
                    continue
                if event is None:
                    break
                yield _sse(event, data)
                if event == "done":
                    break
        finally:
            job_manager.unsubscribe(job_id, queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
