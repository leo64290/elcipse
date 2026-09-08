"""Boucle de feedback: relie une note bien/mal a l'apprentissage de la tache."""
from __future__ import annotations

from . import db, models
from .task_base import Sample, Task


def record_feedback(task: Task, sample_id: str, rating: str, note: str = "") -> dict:
    if rating not in ("good", "bad"):
        raise ValueError("rating doit valoir 'good' ou 'bad'")

    row = db.get_sample(sample_id)
    if row is None or row["task_id"] != task.task_id:
        raise ValueError(f"sample {sample_id} introuvable pour la tache {task.task_id}")

    feedback_id = db.save_feedback(sample_id, task.task_id, rating, note)

    sample = Sample(observation=row["observation"], action=row["action"])
    task.learn_from_feedback(sample, rating, note)

    return {"feedback_id": feedback_id, "stats": db.feedback_stats(task.task_id)}


def save_current_state_as_base(task: Task, label: str = "") -> dict:
    """Fige l'etat courant (apres apprentissage) comme nouvelle base reutilisable."""
    return models.save_state_as_base(task.task_id, task.get_state(), label=label)
