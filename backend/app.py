from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from examples import get_example, list_examples
from simulator import CircuitError, simulate, validate_circuit
from storage import CircuitStore


STORE = CircuitStore()


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "DigitalLab/0.1"

    def _send(self, status: int, payload, *, content_type: str = "application/json") -> None:
        if content_type == "application/json":
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        else:
            body = payload if isinstance(payload, bytes) else str(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self._send(204, b"", content_type="text/plain")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        try:
            if parts == ["api", "health"]:
                self._send(200, {"ok": True})
            elif parts == ["api", "examples"]:
                self._send(200, {"examples": list_examples()})
            elif len(parts) == 3 and parts[:2] == ["api", "examples"]:
                self._send(200, get_example(parts[2]))
            elif parts == ["api", "circuits"]:
                self._send(200, {"circuits": STORE.list_circuits()})
            elif len(parts) == 3 and parts[:2] == ["api", "circuits"]:
                record = STORE.get(parts[2])
                if record is None:
                    self._send(404, {"error": "circuit not found"})
                else:
                    self._send(200, record)
            else:
                self._send(404, {"error": "not found"})
        except KeyError:
            self._send(404, {"error": "example not found"})
        except Exception as error:  # pragma: no cover - HTTP boundary
            self._send(500, {"error": str(error)})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        try:
            payload = self._read_json()
            if parts == ["api", "simulate"]:
                max_time = int(payload.get("maxTime", 160))
                result = simulate(payload["circuit"], payload.get("stimulus"), max_time=max_time)
                result["revision"] = payload.get("revision")
                result["circuitName"] = str(payload.get("circuitName") or "未命名电路")
                self._send(200, result)
            elif parts == ["api", "circuits"]:
                validate_circuit(payload["circuit"])
                self._send(201, STORE.save(payload))
            else:
                self._send(404, {"error": "not found"})
        except (CircuitError, ValueError, KeyError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # pragma: no cover - HTTP boundary
            self._send(500, {"error": str(error)})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        try:
            payload = self._read_json()
            if len(parts) == 3 and parts[:2] == ["api", "circuits"]:
                validate_circuit(payload["circuit"])
                self._send(200, STORE.save(payload, parts[2]))
            else:
                self._send(404, {"error": "not found"})
        except (CircuitError, ValueError, KeyError, json.JSONDecodeError) as error:
            self._send(400, {"error": str(error)})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        if len(parts) == 3 and parts[:2] == ["api", "circuits"]:
            self._send(200, {"deleted": STORE.delete(parts[2])})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, format, *args):  # noqa: A002
        return


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), ApiHandler)
    print("Digital circuit API running at http://127.0.0.1:8000", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
