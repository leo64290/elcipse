"""IA de pilotage d'un petit robot a base d'ESP32, controle a distance.

La politique de depart est volontairement simple (evitement d'obstacle par
seuil de distance) pour qu'il y ait quelque chose de fonctionnel des le
depart. Les seuils sont la "base" apprise: le feedback bien/mal les ajuste
petit a petit. Rien n'empeche de remplacer get_state/load_state/act par un
vrai modele (RL, reseau de neurones...) plus tard, l'interface Task ne change pas.
"""
from __future__ import annotations

from typing import Any

from core.task_base import Sample, Task

from .esp32_client import Esp32Robot

DEFAULT_STATE = {
    "obstacle_distance_cm": 20.0,
    "step_size_cm": 2.0,
}


class Esp32RobotTask(Task):
    task_id = "esp32_robot"
    label = "Robot ESP32 (pilotage a distance)"
    description = (
        "Recoit la distance mesuree par le robot (capteur ultrason) et decide "
        "d'avancer, tourner ou s'arreter. Peut envoyer la commande directement "
        "a l'ESP32 si son IP est fournie."
    )

    def __init__(self) -> None:
        self.obstacle_distance_cm = DEFAULT_STATE["obstacle_distance_cm"]
        self.step_size_cm = DEFAULT_STATE["step_size_cm"]

    def act(self, observation: dict[str, Any]) -> Sample:
        distance_cm = float(observation.get("distance_cm", 999))
        esp32_ip = observation.get("esp32_ip")

        if distance_cm < self.obstacle_distance_cm:
            command = "left"
        else:
            command = "forward"

        action = {"command": command, "threshold_used_cm": self.obstacle_distance_cm}

        if esp32_ip:
            robot = Esp32Robot(esp32_ip)
            action["esp32_response"] = robot.send_command(command)

        return Sample(observation=observation, action=action)

    def get_state(self) -> dict[str, Any]:
        return {
            "obstacle_distance_cm": self.obstacle_distance_cm,
            "step_size_cm": self.step_size_cm,
        }

    def load_state(self, state: dict[str, Any]) -> None:
        self.obstacle_distance_cm = state.get("obstacle_distance_cm", self.obstacle_distance_cm)
        self.step_size_cm = state.get("step_size_cm", self.step_size_cm)

    def learn_from_feedback(self, sample: Sample, rating: str, note: str = "") -> None:
        command = sample.action.get("command")
        distance_cm = float(sample.observation.get("distance_cm", 999))

        if rating == "bad" and command == "forward":
            # Le robot a avance alors qu'il n'aurait pas du -> etre plus prudent.
            self.obstacle_distance_cm = min(
                self.obstacle_distance_cm + self.step_size_cm, distance_cm
            )
        elif rating == "bad" and command == "left":
            # Le robot a evite un obstacle qui n'en etait pas un -> etre moins prudent.
            self.obstacle_distance_cm = max(
                self.obstacle_distance_cm - self.step_size_cm, 0.0
            )
        # rating == "good" -> on ne touche a rien, le comportement est valide.
