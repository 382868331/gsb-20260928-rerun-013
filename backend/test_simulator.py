from copy import deepcopy

from examples import get_example
from simulator import request_fingerprint, simulate


def test_distinct_gate_delays_create_real_timed_events():
    example = get_example("combinational")
    result = simulate(example["circuit"], example["stimulus"], max_time=160)
    events = result["events"]
    assert result["status"] == "stable"
    nand_changes = [{k: event[k] for k in ("time", "node", "value")} for event in events if event["node"] == "nand"]
    led_changes = [{k: event[k] for k in ("time", "node", "value")} for event in events if event["node"] == "led"]
    assert {"time": 10, "node": "nand", "value": 1} in nand_changes
    assert {"time": 65, "node": "nand", "value": 0} in nand_changes
    assert {"time": 90, "node": "led", "value": 1} in led_changes
    assert {"time": 130, "node": "led", "value": 0} in led_changes


def test_feedback_latch_settles_to_stable_state():
    example = get_example("latch")
    result = simulate(example["circuit"], example["stimulus"], max_time=180)
    assert result["status"] == "stable"
    assert result["finalValues"]["Q"] == 0
    assert result["finalValues"]["NQ"] == 1
    assert result["pendingEvents"] == 0


def test_feedback_loop_without_stable_point_is_oscillating():
    example = get_example("oscillator")
    result = simulate(example["circuit"], example["stimulus"], max_time=80)
    assert result["status"] == "oscillating"
    assert result["pendingEvents"] > 0
    changes = [event["time"] for event in result["events"] if event["node"] == "clk"]
    assert changes == [8, 16, 24, 32, 40, 48, 56, 64, 72, 80]


def test_disconnected_input_and_multiple_drivers_are_visible():
    example = get_example("faults")
    result = simulate(example["circuit"], example["stimulus"], max_time=40)
    severities = {item["severity"] for item in result["diagnostics"]}
    assert "contention" in severities
    assert "disconnected" in severities
    assert result["finalValues"]["check"] == "x"


def test_modified_component_delay_cannot_reuse_old_run():
    example = get_example("combinational")
    first = simulate(example["circuit"], example["stimulus"], max_time=160)
    example["circuit"]["nodes"][2]["delay"] = 18
    second = simulate(example["circuit"], example["stimulus"], max_time=160)
    assert first["events"] != second["events"]
    assert {"time": 73, "node": "nand", "value": 0} in [
        {"time": event["time"], "node": event["node"], "value": event["value"]}
        for event in second["events"]
    ]


def test_fingerprint_tracks_logical_revision_but_not_canvas_position():
    example = get_example("combinational")
    moved = deepcopy(example)
    moved["circuit"]["nodes"][0]["position"] = {"x": 12, "y": 34}
    delayed = deepcopy(example)
    delayed["circuit"]["nodes"][2]["delay"] = 18

    assert request_fingerprint(example["circuit"], example["stimulus"], 160) == request_fingerprint(
        moved["circuit"], moved["stimulus"], 160
    )
    assert request_fingerprint(example["circuit"], example["stimulus"], 160) != request_fingerprint(
        delayed["circuit"], delayed["stimulus"], 160
    )


def test_result_carries_fingerprint_for_loaded_initial_values():
    example = get_example("latch")
    fingerprint = request_fingerprint(example["circuit"], example["stimulus"], 180)
    result = simulate(example["circuit"], example["stimulus"], max_time=180)
    assert result["circuitFingerprint"] == fingerprint


def test_connection_changes_revision_fingerprint_and_diagnostics():
    example = get_example("faults")
    original_fingerprint = request_fingerprint(example["circuit"], example["stimulus"], 40)
    repaired = deepcopy(example)
    repaired["circuit"]["edges"][1]["targetPort"] = "in2"
    repaired_fingerprint = request_fingerprint(repaired["circuit"], repaired["stimulus"], 40)
    result = simulate(repaired["circuit"], repaired["stimulus"], max_time=40)

    assert repaired_fingerprint != original_fingerprint
    assert "contention" not in {item["severity"] for item in result["diagnostics"]}
