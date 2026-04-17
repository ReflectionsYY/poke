import sqlite3
from contextlib import contextmanager
from pathlib import Path


class State:
    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS processed (
                    submission_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def get_last_seen(self) -> str | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT v FROM kv WHERE k = 'last_seen_submission_id'"
            ).fetchone()
            return row[0] if row else None

    def set_last_seen(self, submission_id: str) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO kv (k, v) VALUES ('last_seen_submission_id', ?)",
                (submission_id,),
            )

    def mark_processed(self, submission_id: str, user_id: str, status: str) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO processed (submission_id, user_id, status) "
                "VALUES (?, ?, ?)",
                (submission_id, user_id, status),
            )

    def is_processed(self, submission_id: str) -> bool:
        with self._conn() as c:
            row = c.execute(
                "SELECT 1 FROM processed WHERE submission_id = ?",
                (submission_id,),
            ).fetchone()
            return row is not None
