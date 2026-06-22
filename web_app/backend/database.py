import sqlite3
from datetime import datetime
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "research.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scrapes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            content TEXT,
            extraction_type TEXT NOT NULL,
            timestamp TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def save_scrape(url: str, title: str | None, content: str | None, extraction_type: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        """
        INSERT INTO scrapes (url, title, content, extraction_type, timestamp)
        VALUES (?, ?, ?, ?, ?)
    """,
        (url, title, content, extraction_type, timestamp),
    )
    conn.commit()
    conn.close()

def get_scrapes(search_query: str | None = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if search_query:
        cursor.execute(
            """
            SELECT * FROM scrapes 
            WHERE url LIKE ? OR title LIKE ? OR content LIKE ?
            ORDER BY id DESC
        """,
            (f"%{search_query}%", f"%{search_query}%", f"%{search_query}%"),
        )
    else:
        cursor.execute("SELECT * FROM scrapes ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def delete_scrape(scrape_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM scrapes WHERE id = ?", (scrape_id,))
    conn.commit()
    conn.close()
