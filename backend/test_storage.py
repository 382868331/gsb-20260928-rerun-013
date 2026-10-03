from storage import CircuitStore


def test_save_persists_view_state_selection_and_ready_results(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    circuit = {
        "nodes": [{"id": "A", "type": "INPUT", "label": "A", "delay": 0, "initial": 0}],
        "edges": [],
    }
    simulation_result = {
        "fingerprint": "fp-current",
        "maxTime": 80,
        "waveforms": {"A": [{"time": 0, "value": 0}]},
    }
    payload = {
        "name": "view state",
        "circuit": circuit,
        "stimulus": {"events": []},
        "plans": [],
        "activePlanId": "plan-1",
        "runs": {
            "fp-current": {"fingerprint": "fp-current", "status": "ready", "result": simulation_result, "planId": "plan-1"},
            "fp-running": {"fingerprint": "fp-running", "status": "running"},
        },
        "viewState": {
            "maxTime": 80,
            "cursorTime": 160,
            "zoom": 3,
            "panelWidth": 520,
            "resultsCollapsed": True,
            "selection": {"time": 30, "nodeId": "led", "fingerprint": "fp-current", "reason": "波形首次差异"},
        },
    }

    saved = store.save(payload)
    loaded = store.get(saved["id"])

    assert loaded["viewState"] == payload["viewState"]
    assert loaded["runs"] == payload["runs"]


def test_invalid_optional_persistence_fields_are_normalized_to_none(tmp_path):
    store = CircuitStore(tmp_path / "circuits.json")
    saved = store.save({
        "name": "invalid optional",
        "circuit": {"nodes": [{"id": "A", "type": "INPUT"}], "edges": []},
        "runs": [],
        "viewState": "80",
    })

    assert saved["runs"] is None
    assert saved["viewState"] is None
