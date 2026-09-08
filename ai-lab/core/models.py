"""Registre des 'bases' (checkpoints/parametres) reutilisables par tache.

Une base est juste un fichier JSON (ou binaire, pour un vrai modele ML)
associe a une tache, avec un manifeste qui liste les bases disponibles
et laquelle est active. Ca permet de repartir d'un modele deja entraine
au lieu de recommencer de zero a chaque fois.
"""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

STORE_DIR = Path(__file__).resolve().parent.parent / "models_store"
MANIFEST_PATH = STORE_DIR / "manifest.json"


def _load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text())


def _save_manifest(manifest: dict) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))


def list_bases(task_id: str) -> list[dict]:
    manifest = _load_manifest()
    return manifest.get(task_id, {}).get("bases", [])


def get_active_base(task_id: str) -> dict | None:
    manifest = _load_manifest()
    task_entry = manifest.get(task_id, {})
    active_id = task_entry.get("active_base_id")
    for base in task_entry.get("bases", []):
        if base["id"] == active_id:
            return base
    return None


def save_state_as_base(task_id: str, state: dict, label: str = "", activate: bool = True) -> dict:
    """Enregistre l'etat courant d'une tache (core.task_base.Task.get_state()) comme nouvelle base."""
    manifest = _load_manifest()
    task_entry = manifest.setdefault(task_id, {"bases": [], "active_base_id": None})

    base_id = uuid.uuid4().hex
    task_dir = STORE_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    state_path = task_dir / f"{base_id}.json"
    state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False))

    base_entry = {
        "id": base_id,
        "label": label or f"base-{base_id[:8]}",
        "file": str(state_path.relative_to(STORE_DIR)),
        "created_at": time.time(),
    }
    task_entry["bases"].append(base_entry)
    if activate:
        task_entry["active_base_id"] = base_id
    _save_manifest(manifest)
    return base_entry


def import_base_file(task_id: str, source_path: Path, label: str = "", activate: bool = True) -> dict:
    """Importe un fichier de base existant (ex: recupere d'un autre projet/tache similaire)."""
    manifest = _load_manifest()
    task_entry = manifest.setdefault(task_id, {"bases": [], "active_base_id": None})

    base_id = uuid.uuid4().hex
    task_dir = STORE_DIR / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    dest_path = task_dir / f"{base_id}{source_path.suffix}"
    shutil.copyfile(source_path, dest_path)

    base_entry = {
        "id": base_id,
        "label": label or source_path.stem,
        "file": str(dest_path.relative_to(STORE_DIR)),
        "created_at": time.time(),
    }
    task_entry["bases"].append(base_entry)
    if activate:
        task_entry["active_base_id"] = base_id
    _save_manifest(manifest)
    return base_entry


def activate_base(task_id: str, base_id: str) -> None:
    manifest = _load_manifest()
    task_entry = manifest.get(task_id)
    if not task_entry or not any(b["id"] == base_id for b in task_entry["bases"]):
        raise ValueError(f"base {base_id} introuvable pour la tache {task_id}")
    task_entry["active_base_id"] = base_id
    _save_manifest(manifest)


def load_base_state(base_entry: dict) -> dict:
    path = STORE_DIR / base_entry["file"]
    return json.loads(path.read_text())
