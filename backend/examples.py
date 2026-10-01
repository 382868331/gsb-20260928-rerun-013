from __future__ import annotations

from copy import deepcopy


def _node(node_id, node_type, label, x, y, *, delay=10, initial=0):
    return {
        "id": node_id,
        "type": node_type,
        "label": label,
        "delay": delay,
        "initial": initial,
        "position": {"x": x, "y": y},
    }


EXAMPLES = {
    "combinational": {
        "name": "组合逻辑：延迟不同的 NAND + NOT",
        "description": "A、B 经 10ns NAND，再经 25ns NOT；每个跳变都由独立事件产生。",
        "circuit": {
            "nodes": [
                _node("A", "INPUT", "A", 40, 70),
                _node("B", "INPUT", "B", 40, 210),
                _node("nand", "NAND", "NAND 10ns", 270, 130, delay=10, initial="x"),
                _node("led", "NOT", "NOT 25ns", 520, 130, delay=25, initial="x"),
            ],
            "edges": [
                {"id": "e-a", "source": "A", "target": "nand", "targetPort": "in1"},
                {"id": "e-b", "source": "B", "target": "nand", "targetPort": "in2"},
                {"id": "e-nand", "source": "nand", "target": "led", "targetPort": "in"},
            ],
        },
        "stimulus": {
            "id": "combinational",
            "name": "基础跳变",
            "version": 1,
            "events": [
                {"time": 20, "node": "A", "value": 1},
                {"time": 55, "node": "B", "value": 1},
                {"time": 95, "node": "A", "value": 0},
            ]
        },
    },
    "latch": {
        "name": "反馈稳定：NAND 锁存器",
        "description": "低有效 S/R 锁存器；S 脉冲后交叉反馈进入新的稳定状态。",
        "circuit": {
            "nodes": [
                _node("S", "INPUT", "S", 40, 70, initial=1),
                _node("R", "INPUT", "R", 40, 250, initial=1),
                _node("Q", "NAND", "Q 8ns", 300, 70, delay=8, initial=1),
                _node("NQ", "NAND", "/Q 8ns", 300, 250, delay=8, initial=1),
            ],
            "edges": [
                {"id": "l-s", "source": "S", "target": "Q", "targetPort": "in1"},
                {"id": "l-nq", "source": "NQ", "target": "Q", "targetPort": "in2"},
                {"id": "l-r", "source": "R", "target": "NQ", "targetPort": "in1"},
                {"id": "l-q", "source": "Q", "target": "NQ", "targetPort": "in2"},
            ],
        },
        "stimulus": {
            "id": "latch",
            "name": "锁存脉冲",
            "version": 1,
            "initial": {"S": 1, "R": 1},
            "events": [
                {"time": 20, "node": "S", "value": 0},
                {"time": 44, "node": "S", "value": 1},
                {"time": 90, "node": "R", "value": 0},
                {"time": 114, "node": "R", "value": 1},
            ],
        },
    },
    "oscillator": {
        "name": "持续振荡：NOT 反馈环",
        "description": "NOT 输出直接接回输入，8ns 周期翻转，超过观测窗口仍有未处理事件。",
        "circuit": {
            "nodes": [
                _node("clk", "NOT", "NOT 8ns", 300, 140, delay=8, initial=0),
            ],
            "edges": [
                {"id": "o-loop", "source": "clk", "target": "clk", "targetPort": "in"}
            ],
        },
        "stimulus": {"id": "oscillator", "name": "无外部激励", "version": 1, "events": []},
    },
    "faults": {
        "name": "可见故障：断连与输出争用",
        "description": "两个输出接到同一端口产生争用；悬空输入传播为 X。",
        "circuit": {
            "nodes": [
                _node("low", "INPUT", "0", 50, 70, initial=0),
                _node("high", "INPUT", "1", 50, 210, initial=1),
                _node("check", "AND", "AND 10ns", 330, 140, delay=10, initial="x"),
            ],
            "edges": [
                {"id": "f-low", "source": "low", "target": "check", "targetPort": "in1"},
                {"id": "f-high", "source": "high", "target": "check", "targetPort": "in1"},
            ],
        },
        "stimulus": {"id": "faults", "name": "稳态故障", "version": 1, "events": []},
    },
}


def list_examples():
    return [
        {"id": key, "name": value["name"], "description": value["description"]}
        for key, value in EXAMPLES.items()
    ]


def get_example(example_id: str):
    return deepcopy(EXAMPLES[example_id])
