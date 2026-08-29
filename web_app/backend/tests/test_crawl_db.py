import crawl_db


def _rows(n, start=1):
    return [
        {
            "url": f"https://example.com/page{i}",
            "title": f"Page {i}",
            "content": f"body {i}",
            "depth": 0 if i == 1 else 1,
            "status_code": 200,
            "content_chars": len(f"body {i}"),
            "timestamp": "2026-08-10 12:00:00",
        }
        for i in range(start, start + n)
    ]


def test_job_and_item_lifecycle(temp_db):
    job = crawl_db.create_job("job1", "My Crawl", "static", '{"max_depth": 1}')
    assert job["status"] == "queued"
    assert job["items_count"] == 0

    assert crawl_db.insert_items("job1", _rows(3)) == 3
    assert crawl_db.count_items("job1") == 3

    # Duplicate (job_id, url) is ignored -- this is what makes checkpoint-resume
    # and any accidental double-flush idempotent.
    crawl_db.insert_items("job1", _rows(1))
    assert crawl_db.count_items("job1") == 3

    page = crawl_db.get_items("job1", limit=2, offset=1)
    assert [r["url"] for r in page] == [
        "https://example.com/page2",
        "https://example.com/page3",
    ]
    # content is withheld unless asked for, so the job table stays light
    assert all(r["content"] is None for r in page)
    assert crawl_db.get_items("job1", limit=1, include_content=True)[0]["content"] == "body 1"

    crawl_db.update_job_stats("job1", '{"items_scraped": 3}', 3)
    assert crawl_db.get_job("job1")["items_count"] == 3

    assert crawl_db.delete_job("job1") is True
    assert crawl_db.get_job("job1") is None
    assert crawl_db.count_items("job1") == 0


def test_reconcile_marks_interrupted_jobs(temp_db):
    crawl_db.create_job("running1", "R", "static", "{}")
    crawl_db.set_job_status("running1", "running", started_at="2026-08-10 12:00:00")
    crawl_db.create_job("queued1", "Q", "static", "{}")
    crawl_db.create_job("done1", "D", "static", "{}")
    crawl_db.set_job_status("done1", "completed", finished_at="2026-08-10 12:05:00")

    assert crawl_db.reconcile_on_startup(has_checkpoint=lambda _job_id: False) == 2

    assert crawl_db.get_job("running1")["status"] == "stopped"
    assert "restart" in crawl_db.get_job("running1")["error"]
    assert crawl_db.get_job("queued1")["status"] == "stopped"
    # terminal jobs are left alone
    assert crawl_db.get_job("done1")["status"] == "completed"
    assert crawl_db.get_job("done1")["error"] is None


def test_reconcile_pauses_resumable_jobs_with_checkpoint(temp_db):
    crawl_db.create_job("res1", "Resumable", "static", "{}")
    crawl_db.set_job_status("res1", "running")

    crawl_db.reconcile_on_startup(has_checkpoint=lambda job_id: job_id == "res1")

    job = crawl_db.get_job("res1")
    assert job["status"] == "paused"
    assert "resumable" in job["error"]


def test_iter_items_streams_everything(temp_db):
    crawl_db.create_job("big", "Big", "static", "{}")
    crawl_db.insert_items("big", _rows(25))
    urls = [r["url"] for r in crawl_db.iter_items("big", chunk=10)]
    assert len(urls) == 25
    assert urls == sorted(urls, key=lambda u: int(u.rsplit("page", 1)[1]))


def test_list_jobs_filters_by_status(temp_db):
    crawl_db.create_job("a", "A", "static", "{}")
    crawl_db.create_job("b", "B", "stealthy", "{}")
    crawl_db.set_job_status("b", "completed")

    assert {j["id"] for j in crawl_db.list_jobs()} == {"a", "b"}
    assert [j["id"] for j in crawl_db.list_jobs(status="completed")] == ["b"]
