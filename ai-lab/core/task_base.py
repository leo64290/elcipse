"""Contrat commun que chaque module d'IA (tache) doit respecter."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Sample:
    """Une observation traitee par l'IA, avec ce qu'elle a decide de faire."""

    observation: dict[str, Any]
    action: dict[str, Any]
    meta: dict[str, Any] = field(default_factory=dict)


class Task(ABC):
    """Une IA entrainable pour une tache donnee (robot, mapping, etc.).

    Chaque tache expose la meme interface pour que l'environnement puisse
    l'enregistrer, la faire tourner, recolter du feedback bien/mal dessus,
    et sauvegarder/recharger ses "bases" (parametres appris) de la meme
    facon quel que soit le domaine.
    """

    task_id: str
    label: str
    description: str = ""

    @abstractmethod
    def act(self, observation: dict[str, Any]) -> Sample:
        """Prend une observation, renvoie l'action choisie (et un Sample loggable)."""

    def get_state(self) -> dict[str, Any]:
        """Serialise les parametres actuels de la tache (= une 'base')."""
        return {}

    def load_state(self, state: dict[str, Any]) -> None:
        """Recharge une base precedemment sauvegardee ou importee."""
        return None

    def learn_from_feedback(self, sample: Sample, rating: str, note: str = "") -> None:
        """Ajuste la tache a partir d'un retour 'good'/'bad' de l'utilisateur.

        Implementation par defaut: rien (la tache est en lecture seule tant
        qu'elle ne redefinit pas cette methode). Chaque module est libre
        d'utiliser une regle simple, un score, ou un vrai entrainement ML.
        """
        return None
