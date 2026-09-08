"""Serveur local de l'environnement de creation d'IA.

Lancement: depuis ai-lab/  ->  uvicorn server.app:app --reload
Interface: http://127.0.0.1:8000
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core import db, feedback as feedback_module, models, registry

app = FastAPI(title="AI Lab")

STATIC_DIR = Path(__file__).resolve().parent / "static"


class ActRequest(BaseModel):
    observation: dict[str, Any]


class FeedbackRequest(BaseModel):
    task_id: str
    sample_id: str
    rating: str
    note: str = ""


class ActivateBaseRequest(BaseModel):
    base_id: str


class SaveBaseRequest(BaseModel):
    label: str = ""


@app.get("/api/tasks")
def list_tasks() -> list[dict]:
    return registry.list_task_metadata()


@app.post("/api/tasks/{task_id}/act")
def act(task_id: str, payload: ActRequest) -> dict:
    try:
        task = registry.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    sample = task.act(payload.observation)
    sample_id = db.save_sample(task_id, sample.observation, sample.action)
    return {"sample_id": sample_id, "action": sample.action}


@app.post("/api/feedback")
def send_feedback(payload: FeedbackRequest) -> dict:
    try:
        task = registry.get_task(payload.task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        return feedback_module.record_feedback(
            task, payload.sample_id, payload.rating, payload.note
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/tasks/{task_id}/feedback/stats")
def get_feedback_stats(task_id: str) -> dict:
    return db.feedback_stats(task_id)


@app.get("/api/models/{task_id}")
def list_bases(task_id: str) -> dict:
    return {
        "bases": models.list_bases(task_id),
        "active": models.get_active_base(task_id),
    }


@app.post("/api/models/{task_id}/save_current")
def save_current(task_id: str, payload: SaveBaseRequest) -> dict:
    try:
        task = registry.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return feedback_module.save_current_state_as_base(task, payload.label)


@app.post("/api/models/{task_id}/activate")
def activate_base(task_id: str, payload: ActivateBaseRequest) -> dict:
    try:
        models.activate_base(task_id, payload.base_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Le prochain get_task() doit repartir de la base fraichement activee.
    registry._instances.pop(task_id, None)
    return {"active_base_id": payload.base_id}


@app.post("/api/models/{task_id}/import")
async def import_base(task_id: str, file: UploadFile, label: str = "") -> dict:
    with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "base").suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = Path(tmp.name)

    try:
        base_entry = models.import_base_file(task_id, tmp_path, label=label or file.filename or "")
    finally:
        tmp_path.unlink(missing_ok=True)

    registry._instances.pop(task_id, None)
    return base_entry


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
