"""Client HTTP minimal pour parler a un ESP32 qui fait tourner le firmware
fourni dans firmware/esp32_robot_controller.ino.

Le firmware expose:
  GET /sensors           -> {"distance_cm": <float>}
  GET /command?cmd=<cmd> -> "OK" (cmd in forward/back/left/right/stop)
"""
from __future__ import annotations

import requests

DEFAULT_TIMEOUT_S = 2.0


class Esp32Robot:
    def __init__(self, ip: str, timeout: float = DEFAULT_TIMEOUT_S):
        self.base_url = f"http://{ip}"
        self.timeout = timeout

    def read_sensors(self) -> dict:
        response = requests.get(f"{self.base_url}/sensors", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def send_command(self, command: str) -> str:
        response = requests.get(
            f"{self.base_url}/command", params={"cmd": command}, timeout=self.timeout
        )
        response.raise_for_status()
        return response.text
