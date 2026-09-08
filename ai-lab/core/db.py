"""Acces SQLite minimal: un fichier, deux tables (samples, feedback)."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ai_lab.sqlite3"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    observation TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    sample_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
    note TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
"""


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def save_sample(task_id: str, observation: dict, action: dict) -> str:
    sample_id = uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO samples (id, task_id, observation, action, created_at) VALUES (?, ?, ?, ?, ?)",
            (sample_id, task_id, json.dumps(observation), json.dumps(action), time.time()),
        )
    return sample_id


def get_sample(sample_id: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM samples WHERE id = ?", (sample_id,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "task_id": row["task_id"],
        "observation": json.loads(row["observation"]),
        "action": json.loads(row["action"]),
        "created_at": row["created_at"],
    }


def save_feedback(sample_id: str, task_id: str, rating: str, note: str = "") -> str:
    feedback_id = uuid.uuid4().hex
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO feedback (id, sample_id, task_id, rating, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (feedback_id, sample_id, task_id, rating, note, time.time()),
        )
    return feedback_id


def feedback_stats(task_id: str) -> dict:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT rating, COUNT(*) as n FROM feedback WHERE task_id = ? GROUP BY rating",
            (task_id,),
        ).fetchall()
    stats = {"good": 0, "bad": 0}
    for row in rows:
        stats[row["rating"]] = row["n"]
    return stats


def list_feedback(task_id: str, limit: int = 50) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback WHERE task_id = ? ORDER BY created_at DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]
