import json

from examples import get_example
from storage import CircuitStore


def test_save_persists_baseline_compare_and_cursor(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    example = get_example("combinational")
    payload = {
        "name": "交互边界工程",
        "circuit": example["circuit"],
        "stimulus": example["stimulus"],
        "plans": [{"id": "plan-1", "name": "短脉冲", "version": 3, "events": []}],
        "activePlanId": "plan-1",
        "comparePlanId": "plan-2",
        "maxTime": 220,
        "cursorTime": 47,
        "baseline": {
            "label": "修订 #2 · 短脉冲 v2",
            "fingerprint": "fp-locked",
            "circuitFingerprint": "fp-locked-circuit",
            "stimulusFingerprint": "fp-locked-stim",
            "planId": "plan-1",
            "planName": "短脉冲",
            "planVersion": 2,
            "maxTime": 220,
            "result": {"fingerprint": "fp-locked", "status": "stable"},
        },
    }
    saved = store.save(payload)
    assert saved["comparePlanId"] == "plan-2"
    assert saved["maxTime"] == 220
    assert saved["cursorTime"] == 47
    assert saved["baseline"]["planVersion"] == 2

    loaded = store.get(saved["id"])
    assert loaded is not None
    assert loaded["baseline"]["fingerprint"] == "fp-locked"
    assert loaded["activePlanId"] == "plan-1"

    raw = json.loads((tmp_path / "circuits.json").read_text(encoding="utf-8"))
    assert raw[saved["id"]]["cursorTime"] == 47


def test_baseline_must_be_object_when_present(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    example = get_example("combinational")
    try:
        store.save({
            "name": "坏数据",
            "circuit": example["circuit"],
            "stimulus": example["stimulus"],
            "baseline": "not-an-object",
        })
    except ValueError:
        return
    raise AssertionError("invalid baseline should be rejected")
