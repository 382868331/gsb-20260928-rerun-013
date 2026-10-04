from copy import deepcopy

import pytest

from examples import get_example
from simulator import simulate
from storage import CircuitStore


def make_short_pulse_payload():
    circuit = {
        "nodes": [
            {"id": "A", "type": "INPUT", "label": "A", "delay": 0, "initial": 0},
            {"id": "B", "type": "INPUT", "label": "B", "delay": 0, "initial": 0},
            {"id": "and1", "type": "NAND", "label": "NAND1", "delay": 5, "initial": 1},
            {"id": "and2", "type": "NAND", "label": "NAND2", "delay": 15, "initial": 1},
            {"id": "pulse", "type": "XOR", "label": "XOR", "delay": 5, "initial": "x"},
        ],
        "edges": [
            {"source": "A", "target": "and1", "targetPort": "in1"},
            {"source": "B", "target": "and1", "targetPort": "in2"},
            {"source": "A", "target": "and2", "targetPort": "in1"},
            {"source": "B", "target": "and2", "targetPort": "in2"},
            {"source": "and1", "target": "pulse", "targetPort": "in1"},
            {"source": "and2", "target": "pulse", "targetPort": "in2"},
        ],
    }
    plan_a = {"id": "plan-1", "name": "方案 A", "version": 1, "initial": {},
              "events": [{"time": 10, "node": "A", "value": 1}, {"time": 10, "node": "B", "value": 1}]}
    plan_b = {"id": "plan-2", "name": "方案 B", "version": 1, "initial": {},
              "events": [{"time": 12, "node": "A", "value": 1}, {"time": 10, "node": "B", "value": 1}]}
    return circuit, [plan_a, plan_b]


def test_mid_comparison_state_round_trips_through_save_and_reload(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    circuit, plans = make_short_pulse_payload()
    baseline_result = simulate(circuit, {"events": plans[0]["events"]}, max_time=60)
    cursor = {"time": 20, "fingerprint": baseline_result["fingerprint"]}
    saved = store.save({
        "name": "中途比较",
        "circuit": circuit,
        "stimulus": {"events": plans[0]["events"]},
        "plans": plans,
        "activePlanId": "plan-1",
        "comparePlanId": "plan-2",
        "baseline": {"label": "修订 #3 · 方案 A v1", "fingerprint": baseline_result["fingerprint"], "result": baseline_result},
        "maxTime": 60,
        "cursor": cursor,
    })

    reopened = CircuitStore(tmp_path / "circuits.json")
    loaded = reopened.get(saved["id"])
    assert loaded["maxTime"] == 60
    assert loaded["cursor"] == cursor
    assert loaded["comparePlanId"] == "plan-2"
    assert loaded["activePlanId"] == "plan-1"
    assert [plan["id"] for plan in loaded["plans"]] == ["plan-1", "plan-2"]
    assert loaded["baseline"]["result"]["fingerprint"] == baseline_result["fingerprint"]
    assert loaded["baseline"]["result"]["waveforms"] == baseline_result["waveforms"]


def test_reopen_then_modify_short_pulse_keeps_baseline_and_changes_fingerprint(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    circuit, plans = make_short_pulse_payload()
    baseline_result = simulate(circuit, {"events": plans[0]["events"]}, max_time=60)
    saved = store.save({
        "name": "短脉冲",
        "circuit": circuit,
        "stimulus": {"events": plans[0]["events"]},
        "plans": plans,
        "activePlanId": "plan-1",
        "baseline": {"label": "基线", "fingerprint": baseline_result["fingerprint"], "result": baseline_result},
        "maxTime": 60,
        "cursor": {"time": 20, "fingerprint": baseline_result["fingerprint"]},
    })

    loaded = CircuitStore(tmp_path / "circuits.json").get(saved["id"])
    modified = deepcopy(loaded["plans"][0]["events"])
    modified[1]["time"] = 20
    rerun = simulate(loaded["circuit"], {"events": modified}, max_time=loaded["maxTime"])
    assert rerun["fingerprint"] != loaded["baseline"]["fingerprint"]
    pulse_changes = [(e["time"], e["value"]) for e in rerun["events"] if e["node"] == "pulse"]
    assert pulse_changes != [
        (e["time"], e["value"]) for e in loaded["baseline"]["result"]["events"] if e["node"] == "pulse"
    ]
    assert loaded["cursor"]["fingerprint"] == loaded["baseline"]["fingerprint"]


def test_invalid_cursor_or_window_is_rejected(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    circuit, plans = make_short_pulse_payload()
    base = {"name": "x", "circuit": circuit, "stimulus": {"events": []}, "plans": plans}
    with pytest.raises(ValueError):
        store.save({**base, "cursor": {"time": "soon"}})
    with pytest.raises(ValueError):
        store.save({**base, "cursor": {"time": 5}})
    with pytest.raises(ValueError):
        store.save({**base, "maxTime": 0})
    with pytest.raises(ValueError):
        store.save({**base, "maxTime": "long"})


def test_out_of_order_run_results_keep_their_own_combination(tmp_path):
    example = get_example("combinational")
    circuit = example["circuit"]
    stimulus = example["stimulus"]
    wide = simulate(circuit, stimulus, max_time=160)
    narrow = simulate(circuit, stimulus, max_time=80)
    assert wide["fingerprint"] != narrow["fingerprint"]

    store = CircuitStore(tmp_path / "circuits.json")
    saved = store.save({
        "name": "乱序运行",
        "circuit": circuit,
        "stimulus": stimulus,
        "maxTime": 80,
        "cursor": {"time": 120, "fingerprint": wide["fingerprint"]},
        "baseline": {"label": "宽窗口", "fingerprint": wide["fingerprint"], "result": wide},
    })
    loaded = CircuitStore(tmp_path / "circuits.json").get(saved["id"])
    assert loaded["cursor"]["time"] > loaded["maxTime"]
    assert loaded["cursor"]["fingerprint"] == loaded["baseline"]["fingerprint"]
    late_narrow = simulate(circuit, stimulus, max_time=80)
    assert late_narrow["fingerprint"] == narrow["fingerprint"]
    assert late_narrow["fingerprint"] != loaded["cursor"]["fingerprint"]


def test_window_exceeded_result_and_cursor_survive_save_and_reopen(tmp_path):
    example = get_example("combinational")
    narrow = simulate(example["circuit"], example["stimulus"], max_time=20)
    assert narrow["status"] == "window_exceeded"

    store = CircuitStore(tmp_path / "circuits.json")
    saved = store.save({
        "name": "短窗口组合电路",
        "circuit": example["circuit"],
        "stimulus": example["stimulus"],
        "maxTime": 20,
        "cursor": {"time": 20, "fingerprint": narrow["fingerprint"]},
        "baseline": {"label": "短窗口", "fingerprint": narrow["fingerprint"], "result": narrow},
    })

    loaded = CircuitStore(tmp_path / "circuits.json").get(saved["id"])
    assert loaded["baseline"]["result"]["status"] == "window_exceeded"
    assert loaded["baseline"]["result"]["settledTime"] == narrow["settledTime"]
    assert loaded["cursor"] == {"time": 20, "fingerprint": narrow["fingerprint"]}

    widened = simulate(loaded["circuit"], loaded["stimulus"], max_time=311)
    assert widened["status"] == "stable"
    assert widened["settledTime"] == loaded["baseline"]["result"]["settledTime"]
    assert widened["circuitFingerprint"] == loaded["baseline"]["result"]["circuitFingerprint"]
