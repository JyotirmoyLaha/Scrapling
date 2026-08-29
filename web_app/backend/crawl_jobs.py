"""Background crawl job runner and SSE event bus.

One JobManager singleton owns the live jobs. SQLite is the source of truth for
finished ones; this module's in-memory dict only tracks what is currently running,
mirroring the existing active_sessions pattern in main.py.
"""

import asyncio
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

import orjson

import crawl_db
from crawler import CrawlConfig, DashboardSpider

MAX_CONCURRENT_JOBS = 2  # browser modes are heavy on a laptop
STATS_INTERVAL = 1.0  # seconds between stats pushes to subscribers
BATCH_SIZE = 10  # items per SQLite write
BATCH_FLUSH_SECS = 2.0  # ...or this long, whichever comes first
SSE_QUEUE_MAX = 500
GRACEFUL_STOP_SECS = 30  # before escalating a stop request
FORCE_CANCEL_SECS = 5  # after the second pause(), before task.cancel()

_SENTINEL: Tuple[Any, Any] = (None, None)

# Failures we can turn into an instruction instead of a stack trace.
#
# Note the two browser stacks need separate installs, and `scrapling install` only
# covers the first: Dynamic mode uses playwright, Stealthy mode uses patchright, and
# each pins its own Chromium build. A machine can therefore run Dynamic crawls fine
# while every Stealthy crawl dies on a missing executable.
_BROWSER_HINT = (
    "The browser for this mode is not installed. From web_app/backend run "
    "`venv\\Scripts\\python.exe -m patchright install chromium` for Stealthy mode, "
    "or `-m playwright install chromium` for Dynamic mode. Static mode needs no "
    "browser and works meanwhile."
)

_HINTS = (
    ("executable doesn't exist", _BROWSER_HINT),
    ("playwright was just installed", _BROWSER_HINT),
    ("browsertype.launch", _BROWSER_HINT),
)


def _leaf_exceptions(exc: BaseException) -> List[BaseException]:
    """Flatten an ExceptionGroup tree down to the exceptions that actually failed."""
    subs = getattr(exc, "exceptions", None)
    if not subs:
        return [exc]
    out: List[BaseException] = []
    for sub in subs:
        out.extend(_leaf_exceptions(sub))
    return out


def describe_exception(exc: BaseException, max_len: int = 400) -> str:
    """A message worth showing a user.

    anyio runs the crawl inside a task group, so anything that goes wrong arrives
    wrapped as `ExceptionGroup: unhandled errors in a TaskGroup (1 sub-exception)`.
    Formatting that directly tells the reader nothing -- and in the common case
    (browser not installed) it hides a message that says exactly how to fix it.
    So unwrap to the real causes and, where we recognise one, append the fix.
    """
    parts = []
    for leaf in _leaf_exceptions(exc):
        text = " ".join(str(leaf).split()) or leaf.__class__.__name__
        # Playwright/patchright append a multi-line advice banner; the first
        # sentence is the actionable part.
        head = text.split(" ╔")[0].strip()
        parts.append(f"{type(leaf).__name__}: {head}")

    message = " | ".join(dict.fromkeys(parts)) or f"{type(exc).__name__}: {exc}"
    if len(message) > max_len:
        message = message[: max_len - 1] + "…"

    lowered = message.lower()
    for needle, hint in _HINTS:
        if needle in lowered:
            return f"{message} — {hint}"
    return message


@dataclass
class RunningJob:
    job_id: str
    spider: DashboardSpider
    task: Optional[asyncio.Task] = None
    subscribers: Set[asyncio.Queue] = field(default_factory=set)
    last_stats: Dict[str, Any] = field(default_factory=dict)
    recent_items: List[Dict[str, Any]] = field(default_factory=list)
    stop_requested: bool = False
    # Spider.stream() clears spider._engine when it finishes, but the engine's
    # CrawlStats object survives with a finalized end_time. Holding the reference
    # is what lets _final_stats() report true totals rather than the last live sample.
    engine_ref: Any = None


def _item_event(item: Dict[str, Any]) -> Dict[str, Any]:
    """The SSE-safe projection of an item: metadata only, never the content body."""
    return {
        "url": item.get("url"),
        "title": item.get("title"),
        "depth": item.get("depth", 0),
        "status_code": item.get("status_code"),
        "content_chars": item.get("content_chars", 0),
        "timestamp": item.get("timestamp"),
    }


def _item_row(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "url": item.get("url"),
        "title": item.get("title"),
        "content": item.get("content"),
        "extra_json": orjson.dumps(item.get("extra") or {}).decode(),
        "depth": item.get("depth", 0),
        "status_code": item.get("status_code"),
        "content_chars": item.get("content_chars", len(item.get("content") or "")),
        "timestamp": item.get("timestamp"),
    }


class JobManager:
    def __init__(self) -> None:
        self._jobs: Dict[str, RunningJob] = {}
        self._sem: Optional[asyncio.Semaphore] = None

    def _semaphore(self) -> asyncio.Semaphore:
        # Created lazily so the manager can be constructed at import time, before
        # there is a running event loop to bind to.
        if self._sem is None:
            self._sem = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
        return self._sem

    # --------------------------------------------------------------- lifecycle

    def get(self, job_id: str) -> Optional[RunningJob]:
        return self._jobs.get(job_id)

    def is_live(self, job_id: str) -> bool:
        return job_id in self._jobs

    def submit(self, config: CrawlConfig) -> str:
        """Register and start a job. Raises if the config can't build a spider, so
        bad input becomes a synchronous 400 rather than a job that dies instantly."""
        spider = DashboardSpider(
            config,
            on_event=lambda event, data: self._publish(config.job_id, event, data),
        )
        rj = RunningJob(job_id=config.job_id, spider=spider)
        self._jobs[config.job_id] = rj
        rj.task = asyncio.create_task(self._run(rj), name=f"crawl-{config.job_id}")
        return config.job_id

    async def _stats_ticker(self, rj: RunningJob) -> None:
        """Publish stats on a timer, independent of item arrival.

        Doing this only when an item lands (the obvious place) means a crawl that is
        slow to produce -- or produces nothing at all, because every request is being
        blocked -- shows no progress whatsoever and, worse, never captures the engine
        reference the final stats are read from.
        """
        try:
            # Latch the engine as soon as it exists rather than waiting a full tick:
            # a crawl where every request is refused can be over in under a second,
            # and this reference is what the final stats are read from.
            for _ in range(100):
                if getattr(rj.spider, "_engine", None) is not None:
                    rj.engine_ref = rj.spider._engine
                    break
                await asyncio.sleep(0.05)

            while True:
                await asyncio.sleep(STATS_INTERVAL)
                engine = getattr(rj.spider, "_engine", None)
                if engine is not None:
                    rj.engine_ref = engine
                stats = self._live_stats(rj)
                if stats:
                    self._publish(rj.job_id, "stats", stats)
        except asyncio.CancelledError:
            pass

    async def _run(self, rj: RunningJob) -> None:
        job_id = rj.job_id
        buf: List[Dict[str, Any]] = []
        last_flush = time.monotonic()
        ticker: Optional[asyncio.Task] = None
        status, error = "completed", None

        async def flush() -> None:
            if not buf:
                return
            rows = [_item_row(i) for i in buf]
            buf.clear()
            await asyncio.to_thread(crawl_db.insert_items, job_id, rows)

        try:
            # Acquired inside the task so the job visibly sits in 'queued' rather
            # than blocking the POST that created it.
            async with self._semaphore():
                if rj.stop_requested:
                    status = "stopped"
                    return

                await asyncio.to_thread(
                    crawl_db.set_job_status, job_id, "running", started_at=crawl_db.now_ts()
                )
                self._publish(job_id, "status", {"status": "running"})
                ticker = asyncio.create_task(
                    self._stats_ticker(rj), name=f"crawl-stats-{job_id}"
                )

                async for item in rj.spider.stream():
                    buf.append(item)
                    event = _item_event(item)
                    rj.recent_items = ([event] + rj.recent_items)[:50]
                    self._publish(job_id, "item", event)

                    now_m = time.monotonic()
                    if len(buf) >= BATCH_SIZE or (now_m - last_flush) >= BATCH_FLUSH_SECS:
                        await flush()
                        last_flush = now_m

                    # Refresh the cached snapshot on every item (pure dict-building,
                    # no I/O) so the final stats never lag behind. Publishing is the
                    # ticker's job.
                    self._live_stats(rj)

                if rj.stop_requested:
                    # A resumable job that was paused mid-flight can be continued later.
                    status = "paused" if (rj.spider.crawldir and rj.spider.crawldir.exists()) else "stopped"

        except asyncio.CancelledError:
            status, error = "stopped", "Cancelled"
            raise
        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException as e:
            # BaseException rather than Exception: anyio wraps crawl failures in a
            # group, and that group is a BaseExceptionGroup (not an ExceptionGroup)
            # as soon as any member is a BaseException -- which `except Exception`
            # would silently miss, leaving the job stuck as 'running' forever.
            status = "failed"
            error = describe_exception(e)
            print(f"[CRAWL {job_id}] failed: {error}\n{traceback.format_exc()}", flush=True)
        finally:
            if ticker is not None:
                # Cancel before reading final stats so the two cannot interleave.
                ticker.cancel()
                await asyncio.gather(ticker, return_exceptions=True)
            try:
                await flush()
            except Exception as e:  # a write failure must not mask the real status
                print(f"[CRAWL {job_id}] final flush failed: {e}", flush=True)

            final_stats = self._final_stats(rj)
            try:
                count = await asyncio.to_thread(crawl_db.count_items, job_id)

                # A crawl that captured nothing is not a success, whatever the
                # engine thinks: a green 'completed' next to '0 pages' reads as a
                # broken app. Report it as failed, with the reason.
                if status == "completed" and count == 0:
                    status = "failed"
                    error = final_stats.get("content_warning") or (
                        "No pages were captured."
                    )

                await asyncio.to_thread(
                    crawl_db.update_job_stats, job_id, orjson.dumps(final_stats).decode(), count
                )
                await asyncio.to_thread(
                    crawl_db.set_job_status,
                    job_id,
                    status,
                    finished_at=crawl_db.now_ts(),
                    error=error,
                )
            except Exception as e:
                print(f"[CRAWL {job_id}] failed to record final state: {e}", flush=True)

            self._publish(job_id, "done", {"status": status, "error": error, "stats": final_stats})
            self._close_subscribers(rj)
            self._jobs.pop(job_id, None)

    # ------------------------------------------------------------------- stats

    def _live_stats(self, rj: RunningJob) -> Dict[str, Any]:
        """CrawlStats.to_dict() with the live-crawl fields corrected.

        CrawlStats.end_time is only assigned when the crawl finishes, so during a run
        `elapsed_seconds` (= end_time - start_time) is hugely negative and
        `requests_per_second` with it. Recompute both from the loop clock, which is
        the same clock anyio.current_time() used to set start_time.
        """
        try:
            s = rj.spider.stats
        except RuntimeError:
            return rj.last_stats  # engine already torn down; last good snapshot wins

        d = s.to_dict()
        elapsed = 0.0
        if s.start_time:
            elapsed = max(0.0, asyncio.get_running_loop().time() - s.start_time)
        d["elapsed_seconds"] = round(elapsed, 2)
        d["requests_per_second"] = round(s.requests_count / elapsed, 2) if elapsed > 0 else 0.0

        # Private engine internals: useful enough to be worth it, contained to this
        # one function and defaulted so a library bump degrades instead of 500ing.
        engine = getattr(rj.spider, "_engine", None)
        if engine is not None:
            rj.engine_ref = engine
        scheduler = getattr(engine, "scheduler", None)
        try:
            d["queue_size"] = len(scheduler) if scheduler is not None else 0
        except TypeError:
            d["queue_size"] = 0
        d["active_tasks"] = getattr(engine, "_active_tasks", 0) or 0
        d["content_warning"] = rj.spider.extraction_warning(d)

        rj.last_stats = d
        return d

    def _final_stats(self, rj: RunningJob) -> Dict[str, Any]:
        """Totals for a finished crawl.

        CrawlerEngine.crawl() assigns end_time and log_levels_counter on the way out,
        so once the stream is exhausted to_dict() is already correct and needs none of
        the live-crawl correction above.
        """
        stats = getattr(rj.engine_ref, "stats", None)
        if stats is not None and getattr(stats, "end_time", 0):
            d = stats.to_dict()
            d["queue_size"] = 0
            d["active_tasks"] = 0
            d["content_warning"] = rj.spider.extraction_warning(d)
            return d
        return rj.last_stats or {}

    def live_stats(self, job_id: str) -> Dict[str, Any]:
        rj = self._jobs.get(job_id)
        return self._live_stats(rj) if rj else {}

    # --------------------------------------------------------------- stopping

    async def stop(self, job_id: str) -> bool:
        rj = self._jobs.get(job_id)
        if rj is None:
            return False
        rj.stop_requested = True
        rj.spider.request_stop()
        asyncio.create_task(self._escalate(rj), name=f"crawl-stop-{job_id}")
        return True

    async def _escalate(self, rj: RunningJob) -> None:
        """Three levels, matching the engine's own two-stage pause semantics.

        Never cancel the task as the first move: spider.stream() yields from inside
        an anyio task group, and abandoning it raises "Attempted to exit cancel scope
        in a different task". Let the generator drain.
        """
        task = rj.task
        if task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=GRACEFUL_STOP_SECS)
            return
        except asyncio.TimeoutError:
            pass
        except Exception:
            return  # the task finished, however it finished

        rj.spider.request_stop()  # second call => engine force-cancels its task group
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=FORCE_CANCEL_SECS)
            return
        except asyncio.TimeoutError:
            pass
        except Exception:
            return

        if not task.done():
            print(f"[CRAWL {rj.job_id}] graceful stop timed out; cancelling", flush=True)
            task.cancel()

    async def shutdown(self) -> None:
        """Stop every live job. Called from the app lifespan on the way out."""
        jobs = list(self._jobs.values())
        if not jobs:
            return
        print(f"[CRAWL] shutting down {len(jobs)} active job(s)...", flush=True)
        for rj in jobs:
            rj.stop_requested = True
            rj.spider.request_stop()

        tasks = [rj.task for rj in jobs if rj.task is not None]
        if tasks:
            _done, pending = await asyncio.wait(tasks, timeout=20)
            for t in pending:
                t.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

    # -------------------------------------------------------------- SSE bus

    def subscribe(self, job_id: str) -> Optional[asyncio.Queue]:
        rj = self._jobs.get(job_id)
        if rj is None:
            return None
        q: asyncio.Queue = asyncio.Queue(maxsize=SSE_QUEUE_MAX)
        rj.subscribers.add(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue) -> None:
        rj = self._jobs.get(job_id)
        if rj is not None:
            rj.subscribers.discard(q)

    def _publish(self, job_id: str, event: str, data: Dict[str, Any]) -> None:
        """Sync and non-blocking by design: a slow browser tab must never be able to
        stall the crawl loop. On a full queue the oldest event is dropped."""
        rj = self._jobs.get(job_id)
        if rj is None:
            return
        for q in list(rj.subscribers):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait((event, data))
            except asyncio.QueueFull:
                pass

    def _close_subscribers(self, rj: RunningJob) -> None:
        for q in list(rj.subscribers):
            try:
                q.put_nowait(_SENTINEL)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(_SENTINEL)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
        rj.subscribers.clear()


job_manager = JobManager()
