from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any


class CircuitStore:
    def __init__(self, path: str | os.PathLike[str] | None = None):
        self.path = Path(path or Path(__file__).with_name("circuits.json"))
        self._lock = threading.Lock()
        if not self.path.exists():
            self.path.write_text("{}\n", encoding="utf-8")

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        return data if isinstance(data, dict) else {}

    def list_circuits(self) -> list[dict[str, Any]]:
        with self._lock:
            data = self._read()
            return [
                {
                    "id": circuit_id,
                    "name": value.get("name", circuit_id),
                    "updatedAt": value.get("updatedAt"),
                }
                for circuit_id, value in sorted(data.items(), key=lambda item: item[1].get("updatedAt", 0), reverse=True)
                if isinstance(value, dict)
            ]

    def get(self, circuit_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read().get(circuit_id)

    def save(self, payload: dict[str, Any], circuit_id: str | None = None) -> dict[str, Any]:
        circuit_id = circuit_id or payload.get("id") or uuid.uuid4().hex[:12]
        name = str(payload.get("name") or "未命名电路")
        circuit = payload.get("circuit")
        stimulus = payload.get("stimulus", {"events": []})
        if not isinstance(circuit, dict):
            raise ValueError("circuit is required")
        if not isinstance(stimulus, dict):
            raise ValueError("stimulus must be an object")
        record = {
            "id": circuit_id,
            "name": name,
            "circuit": circuit,
            "stimulus": stimulus,
            "updatedAt": int(time.time()),
        }
        with self._lock:
            data = self._read()
            data[circuit_id] = record
            temporary_path = self.path.with_suffix(".tmp")
            temporary_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary_path.replace(self.path)
        return record

    def delete(self, circuit_id: str) -> bool:
        with self._lock:
            data = self._read()
            if circuit_id not in data:
                return False
            del data[circuit_id]
            temporary_path = self.path.with_suffix(".tmp")
            temporary_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary_path.replace(self.path)
        return True
