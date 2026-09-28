import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from examples import FULL_ADDER, SR_LATCH, RING_OSC, CONTENTION
from simulator import simulate_circuit


def run(circuit, duration=200):
    return simulate_circuit(circuit, duration)


def test_and_gate_propagation_delay():
    c = {
        "gates": [
            {"id": "a", "type": "INPUT", "stimulus": [[0, "0"], [10, "1"]]},
            {"id": "b", "type": "INPUT", "stimulus": [[0, "1"]]},
            {"id": "g", "type": "AND", "delay": 5},
            {"id": "o", "type": "OUTPUT"},
        ],
        "wires": [
            {"id": "w1", "from": {"gate": "a"}, "to": {"gate": "g", "pin": 0}},
            {"id": "w2", "from": {"gate": "b"}, "to": {"gate": "g", "pin": 1}},
            {"id": "w3", "from": {"gate": "g"}, "to": {"gate": "o", "pin": 0}},
        ],
    }
    r = run(c, 100)
    assert r["status"] == "stable"
    # AND output goes 1 at t=15 (input at 10 + delay 5), OUTPUT sees it at 15
    assert [15, "1"] in r["traces"]["g"]
    assert [15, "1"] in r["traces"]["o"]


def test_wire_delays_not_collapsed():
    # same source reaches a pin through two wires with different delays:
    # pin must see 1 at t=2 (fast wire), then E is impossible (same value),
    # but with opposing sources the conflict window must appear.
    c = {
        "gates": [
            {"id": "hi", "type": "INPUT", "stimulus": [[0, "1"]]},
            {"id": "lo", "type": "INPUT", "stimulus": [[0, "0"]]},
            {"id": "o", "type": "OUTPUT"},
        ],
        "wires": [
            {"id": "fast", "from": {"gate": "hi"}, "to": {"gate": "o", "pin": 0}, "delay": 2},
            {"id": "slow", "from": {"gate": "lo"}, "to": {"gate": "o", "pin": 0}, "delay": 8},
        ],
    }
    tr = run(c, 100)["traces"]["o"]
    assert [2, "1"] in tr          # fast wire arrives first
    assert [8, "E"] in tr          # slow opposing driver -> contention
    assert tr.index([2, "1"]) < tr.index([8, "E"])


def test_contention_and_resolution():
    r = run(CONTENTION, 200)
    bus = r["traces"]["BUS"]
    # D2 rises at 50, arrives at BUS at 60 while D1=1 -> both 1, no conflict
    assert [60, "1"] in bus
    # D1=1 vs D2=0 -> conflict at t=10 (wire delay 10)
    assert [10, "E"] in bus
    # undriven AND input -> unknown output
    u = r["traces"]["U"]
    assert all(v == "X" for _, v in u)


def test_disconnect_leaves_unknown():
    c = {
        "gates": [
            {"id": "a", "type": "INPUT", "stimulus": [[0, "1"]]},
            {"id": "g", "type": "AND", "delay": 3},
            {"id": "o", "type": "OUTPUT"},
        ],
        "wires": [
            {"id": "w1", "from": {"gate": "a"}, "to": {"gate": "g", "pin": 0}},
            {"id": "w2", "from": {"gate": "g"}, "to": {"gate": "o", "pin": 0}},
        ],
    }
    r = run(c, 50)
    assert all(v == "X" for _, v in r["traces"]["o"])


def test_sr_latch_is_stable_and_holds_state():
    r = run(SR_LATCH, 200)
    assert r["status"] == "stable"
    q = r["traces"]["Q"]
    qb = r["traces"]["Qb"]
    # after S pulse, Q=1; after R pulse, Q=0
    assert q[-1][1] == "0"
    assert any(v == "1" for _, v in q)
    assert qb[-1][1] == "1"


def test_ring_oscillator_detected_as_oscillating():
    r = run(RING_OSC, 200)
    assert r["status"] == "oscillating"
    out = r["traces"]["OUT"]
    # many transitions within the window -> real oscillation waveform
    assert len(out) > 10
    values = {v for _, v in out}
    assert values <= {"0", "1", "X"} and "0" in values and "1" in values


def test_full_adder_truth_table_via_events():
    r = run(FULL_ADDER, 200)
    assert r["status"] == "stable"
    s = dict()
    # sample S and C at t=150: A=0 (fell at 100), B=1 (rose 120), Cin=0 (fell 140)
    # -> S=1, C=0
    def at(trace, t):
        v = "X"
        for tt, vv in trace:
            if tt > t:
                break
            v = vv
        return v
    assert at(r["traces"]["S"], 150) == "1"
    assert at(r["traces"]["C"], 150) == "0"
    # at t=70: A=1,B=1,Cin=1 -> S=1, C=1
    assert at(r["traces"]["S"], 70) == "1"
    assert at(r["traces"]["C"], 70) == "1"


def test_runs_are_independent():
    # mutating the circuit between runs must not leak old results
    base = {
        "gates": [
            {"id": "a", "type": "INPUT", "stimulus": [[0, "1"]]},
            {"id": "o", "type": "OUTPUT"},
        ],
        "wires": [{"id": "w", "from": {"gate": "a"}, "to": {"gate": "o", "pin": 0}}],
    }
    r1 = run(base, 50)
    base["gates"][0]["stimulus"] = [[0, "0"]]
    r2 = run(base, 50)
    assert r1["traces"]["o"][-1][1] == "1"
    assert r2["traces"]["o"][-1][1] == "0"


def test_zero_delay_loop_is_oscillation_not_hang():
    c = {
        "gates": [
            {"id": "n", "type": "NOT", "delay": 0},
            {"id": "k", "type": "INPUT", "stimulus": [[0, "1"]]},
        ],
        "wires": [
            {"id": "w1", "from": {"gate": "n"}, "to": {"gate": "n", "pin": 0}},
            {"id": "w2", "from": {"gate": "k"}, "to": {"gate": "n", "pin": 0}},
        ],
    }
    r = simulate_circuit(c, 100, max_events=5000)
    assert r["status"] == "oscillating"
