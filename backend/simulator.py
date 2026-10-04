from __future__ import annotations

import json
from dataclasses import dataclass, field
from heapq import heappop, heappush
from itertools import count
from typing import Any


ZERO = 0
ONE = 1
UNKNOWN = "x"

BINARY_GATES = {"AND", "OR", "XOR", "NAND", "NOR", "XNOR"}
GATE_INPUTS = {
    "INPUT": [],
    "NOT": ["in"],
    "BUFFER": ["in"],
    **{gate: ["in1", "in2"] for gate in BINARY_GATES},
}
GATE_OUTPUT = "out"

STATUS_STABLE = "stable"
STATUS_FUTURE_EVENTS = "future_events"
STATUS_OSCILLATING = "oscillating"
STATUS_UNKNOWN = "unknown"


class CircuitError(ValueError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def circuit_fingerprint(nodes: dict[str, dict[str, Any]], edges: list[dict[str, str]]) -> str:
    canonical = {
        "edges": [
            {"source": edge["source"], "target": edge["target"], "targetPort": edge["targetPort"]}
            for edge in sorted(
                edges,
                key=lambda edge: (edge["source"], edge["target"], edge["targetPort"]),
            )
        ],
        "nodes": [
            {
                "id": node["id"],
                "type": node["type"],
                "label": node["label"],
                "delay": node["delay"],
                "initial": node["initial"],
            }
            for node in sorted(nodes.values(), key=lambda item: item["id"])
        ],
    }
    return _canonical(canonical)


def stimulus_fingerprint(
    initial_inputs: dict[str, Any],
    events: list[tuple[int, str, Any]],
) -> str:
    canonical = {
        "initial": dict(sorted(initial_inputs.items())),
        "events": [
            {"time": time, "node": node_id, "value": value}
            for time, node_id, value in sorted(events, key=lambda item: (item[0], item[1], str(item[2])))
        ],
    }
    return _canonical(canonical)


def simulation_fingerprint(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, str]],
    initial_inputs: dict[str, Any],
    events: list[tuple[int, str, Any]],
    max_time: int,
) -> str:
    return _canonical({
        "circuit": circuit_fingerprint(nodes, edges),
        "stimulus": stimulus_fingerprint(initial_inputs, events),
        "maxTime": int(max_time),
    })


@dataclass(order=True)
class PendingEvent:
    time: int
    sequence: int
    kind: str = field(compare=False)
    key: str = field(compare=False)
    payload: dict[str, Any] = field(compare=False, default_factory=dict)


def normalize_value(value: Any) -> Any:
    if value in (0, 1, "0", "1"):
        return int(value)
    if value in (None, "", "x", "X", UNKNOWN):
        return UNKNOWN
    raise CircuitError(f"unknown logic value: {value!r}")


def validate_circuit(circuit: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    nodes = circuit.get("nodes")
    edges = circuit.get("edges", [])
    if not isinstance(nodes, list) or not nodes:
        raise CircuitError("circuit must contain at least one node")
    if not isinstance(edges, list):
        raise CircuitError("edges must be a list")

    normalized_nodes: dict[str, dict[str, Any]] = {}
    for raw_node in nodes:
        if not isinstance(raw_node, dict):
            raise CircuitError("each node must be an object")
        node_id = str(raw_node.get("id", ""))
        node_type = str(raw_node.get("type", "")).upper()
        if not node_id:
            raise CircuitError("node id is required")
        if node_id in normalized_nodes:
            raise CircuitError(f"duplicate node id: {node_id}")
        if node_type not in GATE_INPUTS:
            raise CircuitError(f"unsupported gate type: {node_type}")
        delay = int(raw_node.get("delay", 10 if node_type != "INPUT" else 0))
        if node_type != "INPUT" and delay < 1:
            raise CircuitError(f"gate {node_id} delay must be positive")
        if delay < 0:
            raise CircuitError(f"node {node_id} delay cannot be negative")
        initial = raw_node.get("initial", 0 if node_type == "INPUT" else UNKNOWN)
        normalized_nodes[node_id] = {
            "id": node_id,
            "type": node_type,
            "label": str(raw_node.get("label") or node_type),
            "delay": delay,
            "initial": normalize_value(initial),
        }

    normalized_edges: list[dict[str, str]] = []
    seen_connections: set[tuple[str, str, str, str]] = set()
    for raw_edge in edges:
        source = raw_edge.get("source", raw_edge.get("from"))
        source_port = str(raw_edge.get("sourceHandle", raw_edge.get("sourcePort", GATE_OUTPUT)))
        target = raw_edge.get("target", raw_edge.get("to"))
        target_port = str(raw_edge.get("targetHandle", raw_edge.get("targetPort", "")))
        if source is None or target is None:
            raise CircuitError("each edge needs source and target")
        source, target = str(source), str(target)
        if source not in normalized_nodes or target not in normalized_nodes:
            raise CircuitError(f"edge references missing node: {source} -> {target}")
        if source_port != GATE_OUTPUT:
            raise CircuitError(f"output port {source_port} does not exist on {source}")
        allowed_inputs = GATE_INPUTS[normalized_nodes[target]["type"]]
        if target_port not in allowed_inputs:
            raise CircuitError(f"input port {target_port} does not exist on {target}")
        connection = (source, source_port, target, target_port)
        if connection in seen_connections:
            raise CircuitError(f"duplicate connection: {source}.{source_port} -> {target}.{target_port}")
        seen_connections.add(connection)
        normalized_edges.append(
            {
                "source": source,
                "sourcePort": source_port,
                "target": target,
                "targetPort": target_port,
            }
        )
    return normalized_nodes, normalized_edges


def _binary(function_name: str, left: Any, right: Any) -> Any:
    if left == UNKNOWN or right == UNKNOWN:
        return UNKNOWN
    if function_name == "AND":
        value = left and right
    elif function_name == "OR":
        value = left or right
    elif function_name == "XOR":
        value = left ^ right
    elif function_name == "NAND":
        value = not (left and right)
    elif function_name == "NOR":
        value = not (left or right)
    elif function_name == "XNOR":
        value = not (left ^ right)
    else:  # pragma: no cover
        raise CircuitError(f"unsupported binary gate {function_name}")
    return int(value)


def evaluate_gate(node: dict[str, Any], input_values: dict[str, Any]) -> Any:
    node_type = node["type"]
    if node_type == "INPUT":
        return node["initial"]
    if node_type == "NOT":
        value = input_values.get("in", UNKNOWN)
        return UNKNOWN if value == UNKNOWN else int(not value)
    if node_type == "BUFFER":
        return input_values.get("in", UNKNOWN)
    return _binary(node_type, input_values.get("in1", UNKNOWN), input_values.get("in2", UNKNOWN))


def feedback_nodes(nodes: dict[str, dict[str, Any]], edges: list[dict[str, str]]) -> set[str]:
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for edge in edges:
        outgoing[edge["source"]].append(edge["target"])

    cyclic_nodes: set[str] = set()
    for start in nodes:
        stack = list(outgoing[start])
        seen = {start}
        while stack:
            node_id = stack.pop()
            if node_id == start:
                cyclic_nodes.add(start)
                break
            if node_id in seen:
                continue
            seen.add(node_id)
            stack.extend(outgoing[node_id])
    return cyclic_nodes


def simulate(circuit: dict[str, Any], stimulus: dict[str, Any] | None = None, *, max_time: int = 160, max_events: int = 20000) -> dict[str, Any]:
    nodes, edges = validate_circuit(circuit)
    stimulus = stimulus or {}
    initial_inputs = stimulus.get("initial", {})
    events = stimulus.get("events", [])
    if not isinstance(initial_inputs, dict) or not isinstance(events, list):
        raise CircuitError("stimulus.initial must be an object and stimulus.events must be a list")

    original_initial = {node_id: node["initial"] for node_id, node in nodes.items()}
    for node_id, node in nodes.items():
        if node["type"] == "INPUT" and node_id in initial_inputs:
            node["initial"] = normalize_value(initial_inputs[node_id])

    scheduled_input_events: list[tuple[int, str, Any]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise CircuitError("each stimulus event must be an object")
        node_id = str(event.get("node", ""))
        if node_id not in nodes or nodes[node_id]["type"] != "INPUT":
            raise CircuitError(f"stimulus event targets non-input node: {node_id}")
        time = int(event.get("time", 0))
        if time < 0:
            raise CircuitError("stimulus event time cannot be negative")
        scheduled_input_events.append((time, node_id, normalize_value(event.get("value"))))
    scheduled_input_events.sort()

    output_signals: dict[str, list[dict[str, Any]]] = {}
    states: dict[str, Any] = {node_id: node["initial"] for node_id, node in nodes.items()}
    for node_id in nodes:
        output_signals[node_id] = [{"time": 0, "value": states[node_id]}]

    input_ports: dict[str, dict[str, Any]] = {
        node_id: {port_name: UNKNOWN for port_name in GATE_INPUTS[node["type"]]}
        for node_id, node in nodes.items()
    }
    outgoing: dict[str, list[tuple[str, str]]] = {node_id: [] for node_id in nodes}
    sink_drivers: dict[tuple[str, str], list[str]] = {}
    for edge in edges:
        outgoing[edge["source"]].append((edge["target"], edge["targetPort"]))
        sink_key = (edge["target"], edge["targetPort"])
        sink_drivers.setdefault(sink_key, []).append(edge["source"])

    for drivers in sink_drivers.values():
        if len(drivers) != len(set(drivers)):
            raise CircuitError("duplicate driver connected to one input port")

    queue: list[PendingEvent] = []
    sequence = count()
    event_log: list[dict[str, Any]] = []
    diagnostics: list[dict[str, Any]] = []
    conflict_nets: set[str] = set()

    def push(time: int, kind: str, key: str, payload: dict[str, Any]) -> None:
        heappush(queue, PendingEvent(time, next(sequence), kind, key, payload))

    def append_signal(node_id: str, time: int, value: Any, reason: str) -> None:
        if states[node_id] == value:
            return
        states[node_id] = value
        output_signals[node_id].append({"time": time, "value": value})
        event_log.append({"time": time, "node": node_id, "value": value, "reason": reason})

    def resolve_sink(target_id: str, target_port: str, time: int) -> Any:
        drivers = sink_drivers.get((target_id, target_port), [])
        values = [states[driver] for driver in drivers]
        if ZERO in values and ONE in values:
            net_id = "|".join(sorted(drivers + [target_id, target_port]))
            if net_id not in conflict_nets:
                conflict_nets.add(net_id)
                diagnostics.append(
                    {
                        "time": time,
                        "severity": "contention",
                        "message": f"输出争用：{', '.join(sorted(drivers))} 同时驱动 {target_id}.{target_port}，该端口为 X",
                        "drivers": sorted(drivers),
                        "node": target_id,
                        "port": target_port,
                    }
                )
            return UNKNOWN
        if any(value == UNKNOWN for value in values):
            return UNKNOWN
        return values[0] if values else UNKNOWN

    def refresh_sink(target_id: str, target_port: str, time: int) -> None:
        value = resolve_sink(target_id, target_port, time)
        if input_ports[target_id][target_port] == value:
            return
        input_ports[target_id][target_port] = value
        target = nodes[target_id]
        if target["type"] != "INPUT":
            push(time + target["delay"], "gate", target_id, {"cause": target_port})

    def propagate_output(node_id: str, time: int, reason: str) -> None:
        for target_id, target_port in outgoing[node_id]:
            refresh_sink(target_id, target_port, time)

    def record_disconnected_inputs(time: int) -> None:
        for node_id, node in nodes.items():
            for port_name in GATE_INPUTS[node["type"]]:
                if (node_id, port_name) not in sink_drivers:
                    diagnostics.append(
                        {
                            "time": time,
                            "severity": "disconnected",
                            "message": f"{node['label']} ({node_id}) 的输入端口 {port_name} 未连接，按 X 参与计算",
                            "node": node_id,
                            "port": port_name,
                        }
                    )
                    continue
                input_ports[node_id][port_name] = resolve_sink(node_id, port_name, time)

    record_disconnected_inputs(0)
    for node_id, node in nodes.items():
        if node["type"] != "INPUT":
            push(
                node["delay"],
                "gate",
                node_id,
                {
                    "cause": "initialization",
                    "initial_value": evaluate_gate(node, input_ports[node_id]),
                },
            )
    for time, node_id, value in scheduled_input_events:
        push(time, "input", node_id, {"value": value})

    processed = 0
    truncated_reason = ""
    while queue:
        pending = heappop(queue)
        if pending.time > max_time:
            heappush(queue, pending)
            break
        processed += 1
        if processed > max_events:
            truncated_reason = f"超过最大事件数 {max_events}"
            break

        if pending.kind == "input":
            new_value = pending.payload["value"]
            if states[pending.key] != new_value:
                append_signal(pending.key, pending.time, new_value, "用户输入")
                propagate_output(pending.key, pending.time, "用户输入")
            continue

        node_id = pending.key
        node = nodes[node_id]
        new_value = (
            pending.payload["initial_value"]
            if pending.payload.get("cause") == "initialization"
            else evaluate_gate(node, input_ports[node_id])
        )
        if states[node_id] != new_value:
            append_signal(node_id, pending.time, new_value, f"{node['type']} 传播延迟 {node['delay']}")
            propagate_output(node_id, pending.time, "gate-output")

    pending_events = len(queue)
    changed_nodes = sorted({event["node"] for event in event_log})
    next_event_time = queue[0].time if queue else None
    feedback_nodes_in_circuit = feedback_nodes(nodes, edges)
    feedback_changed_nodes = feedback_nodes_in_circuit & set(changed_nodes)
    if truncated_reason:
        status = STATUS_UNKNOWN
        diagnostic = truncated_reason
    elif pending_events == 0:
        status = STATUS_STABLE
        diagnostic = "事件队列已清空，电路已稳定"
    elif not feedback_nodes_in_circuit:
        status = STATUS_FUTURE_EVENTS
        diagnostic = f"观测窗口在 {max_time} 结束，仍有 {pending_events} 个发生在窗口之后的未来事件；电路没有反馈回路"
    else:
        repeated_feedback_changes = {
            node_id
            for node_id in feedback_changed_nodes
            if sum(1 for event in event_log if event["node"] == node_id) >= 2
        }
        pending_nodes = {event.key for event in queue if event.kind == "gate"}
        oscillating_nodes = repeated_feedback_changes & pending_nodes
        if oscillating_nodes:
            status = STATUS_OSCILLATING
            names = ", ".join(sorted(oscillating_nodes))
            diagnostic = f"反馈节点 {names} 在观测窗口内重复翻转，且仍有未来事件，确认持续振荡"
        else:
            status = STATUS_UNKNOWN
            diagnostic = f"反馈回路尚未在观测窗口内出现可确认的重复翻转，下一个事件在 t={next_event_time}；扩大窗口后再判定"

    return {
        "fingerprint": simulation_fingerprint(nodes, edges, initial_inputs, scheduled_input_events, max_time),
        "circuitFingerprint": circuit_fingerprint({node_id: {**node, "initial": original_initial[node_id]} for node_id, node in nodes.items()}, edges),
        "stimulusFingerprint": stimulus_fingerprint(initial_inputs, scheduled_input_events),
        "status": status,
        "diagnostic": diagnostic,
        "maxTime": max_time,
        "processedEvents": processed,
        "pendingEvents": pending_events,
        "changedNodes": changed_nodes,
        "waveforms": output_signals,
        "events": event_log,
        "diagnostics": diagnostics,
        "finalValues": states,
        "nextEventTime": next_event_time,
        "feedbackNodes": sorted(feedback_nodes_in_circuit),
        "reason": diagnostic if truncated_reason else "",
    }
