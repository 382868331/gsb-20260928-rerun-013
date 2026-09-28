"""Built-in example circuits: combinational, stable feedback, oscillator,
and contention/unknown demo."""

def g(gid, gtype, x, y, delay=0, label=None, stimulus=None, value=None):
    gate = {"id": gid, "type": gtype, "x": x, "y": y, "delay": delay,
            "label": label or gid}
    if stimulus is not None:
        gate["stimulus"] = stimulus
    if value is not None:
        gate["value"] = value
    return gate


def w(wid, src, dst, pin, delay=0):
    return {"id": wid, "from": {"gate": src}, "to": {"gate": dst, "pin": pin},
            "delay": delay}


FULL_ADDER = {
    "name": "组合逻辑：全加器",
    "gates": [
        g("A", "INPUT", 40, 60, stimulus=[[0, "0"], [20, "1"], [100, "0"]]),
        g("B", "INPUT", 40, 160, stimulus=[[0, "0"], [40, "1"], [80, "0"], [120, "1"]]),
        g("Cin", "INPUT", 40, 260, stimulus=[[0, "0"], [60, "1"], [140, "0"]]),
        g("xor1", "XOR", 220, 100, delay=6, label="XOR1"),
        g("and1", "AND", 220, 200, delay=4, label="AND1"),
        g("sum", "XOR", 400, 120, delay=6, label="SUM"),
        g("and2", "AND", 400, 220, delay=4, label="AND2"),
        g("cout", "OR", 560, 180, delay=4, label="COUT"),
        g("S", "OUTPUT", 580, 100, label="S"),
        g("C", "OUTPUT", 720, 180, label="C"),
    ],
    "wires": [
        w("w1", "A", "xor1", 0, delay=1), w("w2", "B", "xor1", 1, delay=3),
        w("w3", "A", "and1", 0), w("w4", "B", "and1", 1),
        w("w5", "xor1", "sum", 0), w("w6", "Cin", "sum", 1, delay=2),
        w("w7", "xor1", "and2", 0), w("w8", "Cin", "and2", 1),
        w("w9", "and1", "cout", 0), w("w10", "and2", "cout", 1),
        w("w11", "sum", "S", 0), w("w12", "cout", "C", 0),
    ],
}

SR_LATCH = {
    "name": "反馈：SR 锁存器（稳定）",
    "gates": [
        g("S", "INPUT", 40, 80, stimulus=[[0, "0"], [20, "1"], [40, "0"]]),
        g("R", "INPUT", 40, 240, stimulus=[[0, "0"], [2, "1"], [12, "0"], [90, "1"], [110, "0"]]),
        g("nor1", "NOR", 280, 100, delay=5, label="NOR1"),
        g("nor2", "NOR", 280, 220, delay=5, label="NOR2"),
        g("Q", "OUTPUT", 480, 100, label="Q"),
        g("Qb", "OUTPUT", 480, 220, label="Q'"),
    ],
    "wires": [
        w("w1", "R", "nor1", 0), w("w2", "S", "nor2", 1),
        w("w3", "nor1", "nor2", 0, delay=2),
        w("w4", "nor2", "nor1", 1, delay=2),
        w("w5", "nor1", "Q", 0), w("w6", "nor2", "Qb", 0),
    ],
}

RING_OSC = {
    "name": "反馈：环形振荡器（持续振荡）",
    "gates": [
        g("EN", "INPUT", 40, 80, stimulus=[[0, "0"], [10, "1"]]),
        g("nand", "NAND", 220, 120, delay=4, label="NAND"),
        g("inv1", "NOT", 380, 120, delay=4, label="INV1"),
        g("inv2", "NOT", 540, 120, delay=4, label="INV2"),
        g("OUT", "OUTPUT", 540, 40, label="OUT"),
    ],
    "wires": [
        w("w1", "EN", "nand", 0),
        w("w2", "nand", "inv1", 0),
        w("w3", "inv1", "inv2", 0),
        w("w4", "inv2", "nand", 1, delay=1),
        w("w5", "inv1", "OUT", 0),
    ],
}

CONTENTION = {
    "name": "争用与未知输入",
    "gates": [
        g("D1", "INPUT", 40, 60, stimulus=[[0, "1"]]),
        g("D2", "INPUT", 40, 140, stimulus=[[0, "0"], [50, "1"], [90, "0"]]),
        g("BUS", "OUTPUT", 320, 100, label="BUS"),
        g("EN", "INPUT", 40, 260, stimulus=[[0, "1"]]),
        g("and1", "AND", 260, 260, delay=5, label="AND(一输入悬空)"),
        g("U", "OUTPUT", 460, 260, label="U"),
    ],
    "wires": [
        w("w1", "D1", "BUS", 0),
        w("w2", "D2", "BUS", 0, delay=10),
        w("w3", "EN", "and1", 0),
        w("w4", "and1", "U", 0),
    ],
}

EXAMPLES = [FULL_ADDER, SR_LATCH, RING_OSC, CONTENTION]
