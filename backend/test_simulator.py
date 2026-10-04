from copy import deepcopy

from examples import get_example
from simulator import circuit_fingerprint, simulate, stimulus_fingerprint, validate_circuit


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


def test_observation_window_distinguishes_future_events_oscillation_and_unknown():
    combinational = get_example("combinational")
    short_combinational = simulate(combinational["circuit"], combinational["stimulus"], max_time=20)
    long_combinational = simulate(combinational["circuit"], combinational["stimulus"], max_time=311)
    assert short_combinational["status"] == "future_events"
    assert short_combinational["pendingEvents"] == 5
    assert short_combinational["nextEventTime"] == 25
    assert long_combinational["status"] == "stable"
    assert long_combinational["pendingEvents"] == 0

    latch = get_example("latch")
    short_latch = simulate(latch["circuit"], latch["stimulus"], max_time=20)
    long_latch = simulate(latch["circuit"], latch["stimulus"], max_time=180)
    assert short_latch["status"] == "unknown"
    assert short_latch["pendingEvents"] == 5
    assert long_latch["status"] == "stable"
    assert long_latch["pendingEvents"] == 0

    oscillator = get_example("oscillator")
    short_oscillator = simulate(oscillator["circuit"], oscillator["stimulus"], max_time=20)
    long_oscillator = simulate(oscillator["circuit"], oscillator["stimulus"], max_time=80)
    assert short_oscillator["status"] == "oscillating"
    assert long_oscillator["status"] == "oscillating"
    assert short_oscillator["pendingEvents"] == long_oscillator["pendingEvents"] == 1


def test_event_limit_returns_unknown_instead_of_stable_or_oscillating():
    oscillator = get_example("oscillator")
    result = simulate(oscillator["circuit"], oscillator["stimulus"], max_time=80, max_events=3)
    assert result["status"] == "unknown"
    assert "最大事件数" in result["diagnostic"]


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


def test_fingerprint_tracks_content_but_ignores_canvas_position():
    example = get_example("combinational")
    first = simulate(example["circuit"], example["stimulus"], max_time=160)

    moved = deepcopy(example)
    moved["circuit"]["nodes"][0]["position"] = {"x": 320, "y": 240}
    moved_result = simulate(moved["circuit"], moved["stimulus"], max_time=160)
    assert moved_result["fingerprint"] == first["fingerprint"]

    delayed = deepcopy(example)
    delayed["circuit"]["nodes"][2]["delay"] = 18
    delayed_result = simulate(delayed["circuit"], delayed["stimulus"], max_time=160)
    assert delayed_result["fingerprint"] != first["fingerprint"]

    rewired = deepcopy(example)
    rewired["circuit"]["edges"][0]["targetPort"] = "in2"
    rewired["circuit"]["edges"][1]["targetPort"] = "in1"
    rewired_result = simulate(rewired["circuit"], rewired["stimulus"], max_time=160)
    assert rewired_result["fingerprint"] != first["fingerprint"]

    shorter_window = simulate(example["circuit"], example["stimulus"], max_time=80)
    assert shorter_window["fingerprint"] != first["fingerprint"]


def test_simultaneous_input_changes_can_create_short_gate_pulse():
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
    stimulus = {
        "events": [
            {"time": 10, "node": "A", "value": 1},
            {"time": 10, "node": "B", "value": 1},
            {"time": 10, "node": "A", "value": 1},
        ]
    }
    result = simulate(circuit, stimulus, max_time=60)
    changes = [(event["time"], event["node"], event["value"]) for event in result["events"] if event["node"] == "pulse"]
    assert (15, "and1", 0) in [(event["time"], event["node"], event["value"]) for event in result["events"]]
    assert (25, "and2", 0) in [(event["time"], event["node"], event["value"]) for event in result["events"]]
    assert (20, "pulse", 1) in changes
    assert (30, "pulse", 0) in changes


def test_stimulus_plan_fingerprint_is_separate_from_circuit():
    example = get_example("combinational")
    first = simulate(example["circuit"], example["stimulus"], max_time=160)
    alternative = deepcopy(example["stimulus"])
    alternative["events"] = [{"time": 20, "node": "B", "value": 1}]
    second = simulate(example["circuit"], alternative, max_time=160)

    assert second["circuitFingerprint"] == first["circuitFingerprint"]
    assert second["stimulusFingerprint"] != first["stimulusFingerprint"]
    assert second["fingerprint"] != first["fingerprint"]
    nodes, edges = validate_circuit(example["circuit"])
    assert circuit_fingerprint(nodes, edges) == first["circuitFingerprint"]
    assert stimulus_fingerprint(example["stimulus"].get("initial", {}), [
        (event["time"], event["node"], event["value"])
        for event in example["stimulus"]["events"]
    ]) == first["stimulusFingerprint"]


def test_stimulus_initial_values_are_part_of_plan_fingerprint():
    example = get_example("latch")
    first = simulate(example["circuit"], example["stimulus"], max_time=40)
    changed = deepcopy(example["stimulus"])
    changed["initial"] = {"S": 0, "R": 1}
    second = simulate(example["circuit"], changed, max_time=40)
    assert second["circuitFingerprint"] == first["circuitFingerprint"]
    assert second["stimulusFingerprint"] != first["stimulusFingerprint"]
