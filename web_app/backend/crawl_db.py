"""Persistence for crawl jobs and their scraped items.

Same house style as database.py: raw sqlite3, one connection per call, sqlite3.Row.
Everything lands in the same research.db, reusing database.get_db_connection() so the
WAL/busy_timeout pragmas set there apply here too.

All functions here are blocking. Callers on the event loop must wrap the ones that
scan or write in bulk (insert_items, iter_items, delete_job) in asyncio.to_thread.
"""

import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

import database

SCHEMA_VERSION = 1

# Per-job working directory: checkpoints (crawldir/checkpoint.pkl) and the job log.
CRAWL_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / "crawl_data"
LOG_DIR = CRAWL_DIR / "logs"

JOB_STATUSES = ("queued", "running", "paused", "completed", "failed", "stopped")
TERMINAL_STATUSES = ("completed", "failed", "stopped")


def now_ts() -> str:
    """Timestamp in the same format as scrapes.timestamp, so the two tables sort together."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def job_dir(job_id: str) -> Path:
    return CRAWL_DIR / job_id


def job_log_path(job_id: str) -> Path:
    return LOG_DIR / f"{job_id}.log"


def checkpoint_exists(job_id: str) -> bool:
    """True if a resumable checkpoint was written for this job.

    Filename comes from CheckpointManager.CHECKPOINT_FILE (scrapling/spiders/checkpoint.py:26).
    """
    return (job_dir(job_id) / "checkpoint.pkl").exists()


# --------------------------------------------------------------------------- schema

def init_crawl_tables() -> None:
    CRAWL_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    conn = database.get_db_connection()
    try:
        cur = conn.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS crawl_jobs (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                status       TEXT NOT NULL,
                mode         TEXT NOT NULL,
                config_json  TEXT NOT NULL,
                stats_json   TEXT NOT NULL DEFAULT '{}',
                error        TEXT,
                items_count  INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                started_at   TEXT,
                finished_at  TEXT
            );

            CREATE TABLE IF NOT EXISTS crawl_items (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id        TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
                url           TEXT NOT NULL,
                title         TEXT,
                content       TEXT,
                extra_json    TEXT NOT NULL DEFAULT '{}',
                depth         INTEGER NOT NULL DEFAULT 0,
                status_code   INTEGER,
                content_chars INTEGER NOT NULL DEFAULT 0,
                timestamp     TEXT NOT NULL
            );

            -- status filter + startup reconciliation
            CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status_created
                ON crawl_jobs(status, created_at DESC);
            -- default job list ordering
            CREATE INDEX IF NOT EXISTS idx_crawl_jobs_created
                ON crawl_jobs(created_at DESC);
            -- paginated items endpoint + export scans (covers filter and sort)
            CREATE INDEX IF NOT EXISTS idx_crawl_items_job_id
                ON crawl_items(job_id, id);
            -- lets inserts be INSERT OR IGNORE, making resume/double-write idempotent
            CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_items_job_url
                ON crawl_items(job_id, url);
            """
        )
        cur.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


# ----------------------------------------------------------------------------- jobs

def create_job(job_id: str, name: str, mode: str, config_json: str) -> Dict[str, Any]:
    conn = database.get_db_connection()
    try:
        conn.execute(
            """
            INSERT INTO crawl_jobs (id, name, status, mode, config_json, created_at)
            VALUES (?, ?, 'queued', ?, ?, ?)
            """,
            (job_id, name, mode, config_json, now_ts()),
        )
        conn.commit()
    finally:
        conn.close()
    return get_job(job_id)


def set_job_status(
    job_id: str,
    status: str,
    *,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    sets = ["status = ?"]
    params: List[Any] = [status]
    if started_at is not None:
        sets.append("started_at = ?")
        params.append(started_at)
    if finished_at is not None:
        sets.append("finished_at = ?")
        params.append(finished_at)
    if error is not None:
        sets.append("error = ?")
        params.append(error)
    params.append(job_id)

    conn = database.get_db_connection()
    try:
        conn.execute(f"UPDATE crawl_jobs SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()
    finally:
        conn.close()


def update_job_stats(job_id: str, stats_json: str, items_count: int) -> None:
    conn = database.get_db_connection()
    try:
        conn.execute(
            "UPDATE crawl_jobs SET stats_json = ?, items_count = ? WHERE id = ?",
            (stats_json, items_count, job_id),
        )
        conn.commit()
    finally:
        conn.close()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    conn = database.get_db_connection()
    try:
        row = conn.execute("SELECT * FROM crawl_jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_jobs(status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    conn = database.get_db_connection()
    try:
        if status:
            rows = conn.execute(
                "SELECT * FROM crawl_jobs WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM crawl_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_job(job_id: str) -> bool:
    """Delete the job, its items (via ON DELETE CASCADE), its checkpoint dir and its log."""
    conn = database.get_db_connection()
    try:
        # Explicit item delete too: foreign_keys=ON is set per-connection, and being
        # explicit keeps this correct even if that pragma is ever dropped.
        conn.execute("DELETE FROM crawl_items WHERE job_id = ?", (job_id,))
        cur = conn.execute("DELETE FROM crawl_jobs WHERE id = ?", (job_id,))
        conn.commit()
        deleted = cur.rowcount > 0
    finally:
        conn.close()

    shutil.rmtree(job_dir(job_id), ignore_errors=True)
    try:
        job_log_path(job_id).unlink(missing_ok=True)
    except OSError:
        pass  # Windows may still hold the handle; the row is gone, the log is noise
    return deleted


def reconcile_on_startup(has_checkpoint: Callable[[str], bool] = checkpoint_exists) -> int:
    """Fix up jobs the previous process left mid-flight.

    Nothing is running when this is called, so any row still marked running/queued
    is a casualty of a restart. Resumable jobs with a checkpoint become 'paused';
    everything else becomes 'stopped'.
    """
    conn = database.get_db_connection()
    try:
        rows = conn.execute(
            "SELECT id FROM crawl_jobs WHERE status IN ('running', 'queued')"
        ).fetchall()
        stamp = now_ts()
        for row in rows:
            job_id = row["id"]
            if has_checkpoint(job_id):
                status, error = "paused", "Backend restarted; resumable from checkpoint"
            else:
                status, error = "stopped", "Interrupted by backend restart"
            conn.execute(
                "UPDATE crawl_jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
                (status, error, stamp, job_id),
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


# ---------------------------------------------------------------------------- items

def insert_items(job_id: str, rows: List[Dict[str, Any]]) -> int:
    """Bulk-insert scraped items. Duplicate (job_id, url) pairs are silently skipped."""
    if not rows:
        return 0
    conn = database.get_db_connection()
    try:
        cur = conn.executemany(
            """
            INSERT OR IGNORE INTO crawl_items
                (job_id, url, title, content, extra_json, depth, status_code, content_chars, timestamp)
            VALUES (:job_id, :url, :title, :content, :extra_json, :depth, :status_code, :content_chars, :timestamp)
            """,
            [
                {
                    "job_id": job_id,
                    "url": r["url"],
                    "title": r.get("title"),
                    "content": r.get("content"),
                    "extra_json": r.get("extra_json", "{}"),
                    "depth": r.get("depth", 0),
                    "status_code": r.get("status_code"),
                    "content_chars": r.get("content_chars", len(r.get("content") or "")),
                    "timestamp": r.get("timestamp") or now_ts(),
                }
                for r in rows
            ],
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def count_items(job_id: str) -> int:
    conn = database.get_db_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS n FROM crawl_items WHERE job_id = ?", (job_id,)
        ).fetchone()["n"]
    finally:
        conn.close()


def get_items(
    job_id: str, limit: int = 50, offset: int = 0, include_content: bool = False
) -> List[Dict[str, Any]]:
    cols = (
        "id, job_id, url, title, content, extra_json, depth, status_code, content_chars, timestamp"
        if include_content
        else "id, job_id, url, title, NULL AS content, extra_json, depth, status_code, content_chars, timestamp"
    )
    conn = database.get_db_connection()
    try:
        rows = conn.execute(
            f"SELECT {cols} FROM crawl_items WHERE job_id = ? ORDER BY id LIMIT ? OFFSET ?",
            (job_id, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_item(job_id: str, item_id: int) -> Optional[Dict[str, Any]]:
    conn = database.get_db_connection()
    try:
        row = conn.execute(
            "SELECT * FROM crawl_items WHERE job_id = ? AND id = ?", (job_id, item_id)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def iter_items(job_id: str, chunk: int = 200) -> Iterator[Dict[str, Any]]:
    """Stream every item for a job. Used by the exporters so a large crawl never
    has to be materialised in memory at once."""
    conn = database.get_db_connection()
    try:
        cur = conn.execute(
            "SELECT * FROM crawl_items WHERE job_id = ? ORDER BY id", (job_id,)
        )
        while True:
            rows = cur.fetchmany(chunk)
            if not rows:
                return
            for row in rows:
                yield dict(row)
    finally:
        conn.close()
