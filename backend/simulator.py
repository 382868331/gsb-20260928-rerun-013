"""Event-driven digital logic simulator.

Values: '0', '1', 'X' (unknown), 'E' (contention / conflict).
Every gate has a propagation delay; every wire has its own transport
delay, so signals are never collapsed into a single static evaluation.
"""
from __future__ import annotations

import heapq

UNKNOWN = "X"
CONFLICT = "E"

# gate type -> number of input pins
GATE_INPUTS = {
    "AND": 2, "OR": 2, "XOR": 2, "NAND": 2, "NOR": 2, "XNOR": 2,
    "NOT": 1, "BUF": 1,
    "INPUT": 0, "OUTPUT": 1,
}


def resolve(drivers):
    """Resolve multiple drivers on one pin."""
    vals = set(drivers)
    if not vals:
        return UNKNOWN
    if CONFLICT in vals:
        return CONFLICT
    if "1" in vals and "0" in vals:
        return CONFLICT
    if "1" in vals:
        return "1"
    if "0" in vals:
        return "0"
    return UNKNOWN


def eval_gate(gtype, ins):
    unk = any(v in (UNKNOWN, CONFLICT) for v in ins)
    if gtype in ("AND", "NAND"):
        r = "0" if any(v == "0" for v in ins) else (UNKNOWN if unk else "1")
    elif gtype in ("OR", "NOR"):
        r = "1" if any(v == "1" for v in ins) else (UNKNOWN if unk else "0")
    elif gtype in ("XOR", "XNOR"):
        r = UNKNOWN if unk else ("1" if sum(v == "1" for v in ins) % 2 else "0")
    elif gtype == "NOT":
        r = UNKNOWN if unk else ("1" if ins[0] == "0" else "0")
    elif gtype == "BUF":
        r = UNKNOWN if unk else ins[0]
    else:
        raise ValueError(f"unknown gate type: {gtype}")
    if gtype in ("NAND", "NOR", "XNOR") and r in "01":
        r = "1" if r == "0" else "0"
    return r


def simulate_circuit(circuit, duration, max_events=200000, settle_window=2000):
    """Run an event-driven simulation.

    Returns dict with status ('stable' | 'oscillating'), traces per gate
    id (list of [time, value]), event count and the simulated duration.
    """
    duration = int(duration)
    if duration <= 0:
        raise ValueError("duration must be positive")

    gates = {}
    for g in circuit.get("gates", []):
        if g.get("type") not in GATE_INPUTS:
            raise ValueError(f"unknown gate type: {g.get('type')}")
        if g.get("id") in gates:
            raise ValueError(f"duplicate gate id: {g.get('id')}")
        gates[g["id"]] = g

    wires = list(circuit.get("wires", []))
    pin_drivers = {}   # (gate_id, pin) -> [wire index]
    out_wires = {}     # gate_id -> [wire index]
    for i, w in enumerate(wires):
        src = w.get("from", {}).get("gate")
        dst = w.get("to", {}).get("gate")
        pin = int(w.get("to", {}).get("pin", 0))
        if src not in gates or dst not in gates:
            raise ValueError(f"wire {w.get('id', i)} references unknown gate")
        if pin >= GATE_INPUTS[gates[dst]["type"]]:
            raise ValueError(f"wire {w.get('id', i)} targets invalid pin {pin}")
        pin_drivers.setdefault((dst, pin), []).append(i)
        out_wires.setdefault(src, []).append(i)

    driver_val = [UNKNOWN] * len(wires)

    def pin_value(gid, pin):
        idxs = pin_drivers.get((gid, pin))
        if not idxs:  # undriven pin -> unknown
            return UNKNOWN
        return resolve(driver_val[i] for i in idxs)

    gate_out = {gid: UNKNOWN for gid in gates}
    traces = {gid: [[0, UNKNOWN]] for gid in gates}

    events = []  # heap of (time, seq, kind, a, b)
    seq = 0

    def schedule(time, kind, a, b):
        nonlocal seq
        heapq.heappush(events, (time, seq, kind, a, b))
        seq += 1

    def record(gid, t, val):
        if t > duration:
            return
        tr = traces[gid]
        if tr[-1][0] == t:
            tr[-1][1] = val
        elif tr[-1][1] != val:
            tr.append([t, val])

    # initial conditions
    for gid, g in gates.items():
        if g["type"] == "INPUT":
            stim = g.get("stimulus") or [[0, g.get("value", "0")]]
            for point in stim:
                t, v = int(point[0]), str(point[1])
                if v not in ("0", "1", UNKNOWN):
                    raise ValueError(f"bad stimulus value {v!r} on {gid}")
                schedule(t, "out", gid, v)
        elif g["type"] != "OUTPUT":
            n_in = GATE_INPUTS[g["type"]]
            new = eval_gate(g["type"], [pin_value(gid, p) for p in range(n_in)])
            if new != gate_out[gid]:
                schedule(max(0, int(g.get("delay", 0))), "out", gid, new)

    processed = 0
    status = "stable"
    sim_end = 0
    while events:
        t, _, kind, a, b = heapq.heappop(events)
        processed += 1
        if processed > max_events or t > duration + settle_window:
            status = "oscillating"
            break
        sim_end = max(sim_end, t)
        if kind == "out":
            gid, val = a, b
            if gate_out[gid] == val:
                continue
            gate_out[gid] = val
            record(gid, t, val)
            for wi in out_wires.get(gid, []):
                schedule(t + max(0, int(wires[wi].get("delay", 0))), "wire", wi, val)
        else:  # wire delivers value to a destination pin
            wi, val = a, b
            if driver_val[wi] == val:
                continue
            driver_val[wi] = val
            w = wires[wi]
            dst = w["to"]["gate"]
            g = gates[dst]
            n_in = GATE_INPUTS[g["type"]]
            ins = [pin_value(dst, p) for p in range(n_in)]
            if g["type"] == "OUTPUT":
                record(dst, t, ins[0])
                continue
            new = eval_gate(g["type"], ins)
            if new != gate_out[dst]:
                schedule(t + max(0, int(g.get("delay", 0))), "out", dst, new)

    return {
        "status": status,
        "events": processed,
        "duration": duration,
        "traces": traces,
    }
