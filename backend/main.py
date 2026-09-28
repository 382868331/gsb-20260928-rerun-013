import json
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from examples import EXAMPLES
from simulator import simulate_circuit

app = FastAPI(title="Digital Circuit Design Platform")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE = Path(__file__).parent / "circuits"
STORAGE.mkdir(exist_ok=True)


class SimulateRequest(BaseModel):
    circuit: dict
    duration: int = 200
    max_events: int = 200000


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    try:
        return simulate_circuit(req.circuit, req.duration, req.max_events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/examples")
def list_examples():
    return [{"name": c["name"], "circuit": c} for c in EXAMPLES]


def _path_for(name: str) -> Path:
    if not re.fullmatch(r"[\w\u4e00-\u9fff.-]{1,64}", name):
        raise HTTPException(status_code=400, detail="invalid circuit name")
    return STORAGE / f"{name}.json"


@app.get("/api/circuits")
def list_circuits():
    return sorted(p.stem for p in STORAGE.glob("*.json"))


@app.get("/api/circuits/{name}")
def load_circuit(name: str):
    path = _path_for(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="circuit not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/circuits/{name}")
def save_circuit(name: str, circuit: dict):
    circuit = dict(circuit)
    circuit["name"] = name
    _path_for(name).write_text(
        json.dumps(circuit, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


@app.delete("/api/circuits/{name}")
def delete_circuit(name: str):
    path = _path_for(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="circuit not found")
    path.unlink()
    return {"ok": True}
