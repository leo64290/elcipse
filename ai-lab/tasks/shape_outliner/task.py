"""IA de detourage de formes (utile pour preparer du video mapping).

V1 volontairement simple et sans dependance a un modele lourd: detection de
contours classique (OpenCV) dont les seuils sont la "base" apprise. Le
feedback bien/mal ajuste ces seuils. L'interface Task est la meme que pour
n'importe quel autre module: on peut brancher un vrai modele de segmentation
(SAM, un reseau entraine maison, etc.) plus tard sans changer l'appelant,
juste en remplacant l'implementation de act()/get_state()/load_state().
"""
from __future__ import annotations

import base64
from typing import Any

import cv2
import numpy as np

from core.task_base import Sample, Task

DEFAULT_STATE = {
    "canny_low": 50,
    "canny_high": 150,
    "min_area_px": 200,
}


def _decode_image(observation: dict[str, Any]) -> np.ndarray:
    image_base64 = observation["image_base64"]
    raw = base64.b64decode(image_base64)
    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("image_base64 invalide ou format non supporte")
    return image


def _encode_image(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("echec de l'encodage de l'image de previsualisation")
    return base64.b64encode(buffer).decode("ascii")


class ShapeOutlinerTask(Task):
    task_id = "shape_outliner"
    label = "Detourage de formes (mapping video)"
    description = (
        "Detecte les contours des formes dans une image et renvoie leurs "
        "polygones, avec une previsualisation superposee. Pense pour "
        "preparer des masques de video mapping."
    )

    def __init__(self) -> None:
        self.canny_low = DEFAULT_STATE["canny_low"]
        self.canny_high = DEFAULT_STATE["canny_high"]
        self.min_area_px = DEFAULT_STATE["min_area_px"]

    def act(self, observation: dict[str, Any]) -> Sample:
        image = _decode_image(observation)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, self.canny_low, self.canny_high)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        shapes: list[list[list[int]]] = []
        preview = image.copy()
        for contour in contours:
            if cv2.contourArea(contour) < self.min_area_px:
                continue
            epsilon = 0.01 * cv2.arcLength(contour, True)
            polygon = cv2.approxPolyDP(contour, epsilon, True)
            shapes.append(polygon.reshape(-1, 2).tolist())
            cv2.drawContours(preview, [polygon], -1, (0, 255, 0), 2)

        action = {
            "shapes": shapes,
            "shape_count": len(shapes),
            "preview_base64": _encode_image(preview),
            "thresholds_used": {
                "canny_low": self.canny_low,
                "canny_high": self.canny_high,
                "min_area_px": self.min_area_px,
            },
        }
        # L'image source n'a pas besoin d'etre re-stockee telle quelle dans
        # l'historique des samples: seule la trace des seuils utilises compte
        # pour apprendre. On garde une observation allegee.
        logged_observation = {"image_base64": "<omitted>"}
        return Sample(observation=logged_observation, action=action)

    def get_state(self) -> dict[str, Any]:
        return {
            "canny_low": self.canny_low,
            "canny_high": self.canny_high,
            "min_area_px": self.min_area_px,
        }

    def load_state(self, state: dict[str, Any]) -> None:
        self.canny_low = state.get("canny_low", self.canny_low)
        self.canny_high = state.get("canny_high", self.canny_high)
        self.min_area_px = state.get("min_area_px", self.min_area_px)

    def learn_from_feedback(self, sample: Sample, rating: str, note: str = "") -> None:
        if rating == "good":
            return

        note_lower = note.lower()
        too_many = "trop" in note_lower or "bruit" in note_lower
        too_few = "manque" in note_lower or "pas assez" in note_lower

        if too_few:
            self.min_area_px = max(20, int(self.min_area_px * 0.8))
            self.canny_low = max(10, self.canny_low - 5)
        elif too_many or not note:
            # Par defaut, un "bad" sans precision est traite comme trop de
            # bruit detecte: c'est le defaut le plus courant en mapping.
            self.min_area_px = int(self.min_area_px * 1.2)
            self.canny_low = self.canny_low + 5
