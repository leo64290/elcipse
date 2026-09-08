"""Point d'entree unique pour ajouter une nouvelle IA/tache a l'environnement.

Pour brancher un nouveau module: ecrire une classe Task dans tasks/<mon_module>/
puis l'ajouter a TASK_CLASSES ci-dessous. Tout le reste (UI, feedback,
sauvegarde/reutilisation de bases) fonctionne automatiquement.
"""
from __future__ import annotations

from tasks.esp32_robot.task import Esp32RobotTask
from tasks.shape_outliner.task import ShapeOutlinerTask

from . import models
from .task_base import Task

TASK_CLASSES: dict[str, type[Task]] = {
    Esp32RobotTask.task_id: Esp32RobotTask,
    ShapeOutlinerTask.task_id: ShapeOutlinerTask,
}

_instances: dict[str, Task] = {}


def list_task_metadata() -> list[dict]:
    return [
        {"task_id": tid, "label": cls.label, "description": cls.description}
        for tid, cls in TASK_CLASSES.items()
    ]


def get_task(task_id: str) -> Task:
    if task_id not in TASK_CLASSES:
        raise KeyError(f"tache inconnue: {task_id}")

    if task_id not in _instances:
        task = TASK_CLASSES[task_id]()
        active_base = models.get_active_base(task_id)
        if active_base is not None:
            task.load_state(models.load_base_state(active_base))
        _instances[task_id] = task

    return _instances[task_id]
