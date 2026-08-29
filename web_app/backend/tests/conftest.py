import pytest

import crawl_db
import database


@pytest.fixture
def anyio_backend():
    """anyio ships its own pytest plugin; this pins it to asyncio so we don't
    need pytest-asyncio and don't try to run the trio backend."""
    return "asyncio"


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """Point the whole persistence layer at a throwaway DB + crawl dir."""
    monkeypatch.setattr(database, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(crawl_db, "CRAWL_DIR", tmp_path / "crawl_data")
    monkeypatch.setattr(crawl_db, "LOG_DIR", tmp_path / "crawl_data" / "logs")
    database.init_db()
    crawl_db.init_crawl_tables()
    yield tmp_path
