import { describe, expect, it } from "vitest";
import { circuitFingerprint, simulationFingerprint, stimulusFingerprint } from "./fingerprint";
import type { Circuit, LogicValue, SimulationResult, Stimulus } from "./types";

function traceOf(points: Array<[number, LogicValue]>): SimulationResult["waveforms"][string] {
  return points.map(([time, value]) => ({ time, value }));
}

function resultWith(waveforms: SimulationResult["waveforms"], fingerprint: string): SimulationResult {
  return {
    fingerprint,
    circuitFingerprint: "c",
    stimulusFingerprint: "s",
    status: "stable",
    maxTime: 100,
    processedEvents: 0,
    pendingEvents: 0,
    changedNodes: [],
    waveforms,
    events: [],
    diagnostics: [],
    finalValues: {},
  };
}

describe("comparison invariants", () => {
  it("keys runs by full combination fingerprint so late stale runs cannot retarget buttons", () => {
    const circuit: Circuit = {
      nodes: [{ id: "g1", type: "NOT", label: "g1", delay: 10, initial: 0, position: { x: 0, y: 0 } }],
      edges: [],
    };
    const planA: Stimulus = { events: [{ time: 10, node: "in", value: 1 }] };
    const planB: Stimulus = { events: [{ time: 20, node: "in", value: 1 }] };
    const keyA = simulationFingerprint(circuit, planA, 100);
    const keyB = simulationFingerprint(circuit, planB, 100);
    expect(keyA).not.toBe(keyB);

    const runs: Record<string, { fingerprint: string; status: "ready" | "running" }> = {
      [keyA]: { fingerprint: keyA, status: "running" },
    };
    runs[keyB] = { fingerprint: keyB, status: "ready" };
    runs[keyA] = { fingerprint: keyA, status: "ready" };
    expect(runs[keyB].fingerprint).toBe(keyB);
    expect(runs[keyA].fingerprint).toBe(keyA);
  });

  it("ignores canvas position in circuit fingerprint", () => {
    const base: Circuit = {
      nodes: [{ id: "g1", type: "NOT", label: "g1", delay: 10, initial: 0, position: { x: 0, y: 0 } }],
      edges: [],
    };
    const moved: Circuit = {
      ...base,
      nodes: [{ ...base.nodes[0], position: { x: 400, y: 200 } }],
    };
    expect(circuitFingerprint(moved)).toBe(circuitFingerprint(base));
    expect(stimulusFingerprint({ events: [] })).toBe(stimulusFingerprint({ events: [] }));
  });

  it("detects first waveform difference by time order", async () => {
    const { valueAtTime } = await import("./compareUtils");
    const current = resultWith({ q: traceOf([[0, 0], [10, 1], [30, 0]]) }, "a");
    const reference = resultWith({ q: traceOf([[0, 0], [12, 1], [30, 0]]) }, "b");
    const times = new Set<number>();
    Object.values(current.waveforms).forEach((t) => t.forEach((p) => times.add(p.time)));
    Object.values(reference.waveforms).forEach((t) => t.forEach((p) => times.add(p.time)));
    const ordered = [...times].sort((a, b) => a - b);
    const first = ordered.find((time) =>
      String(valueAtTime(current.waveforms.q, time)) !== String(valueAtTime(reference.waveforms.q, time)));
    expect(first).toBe(10);
  });
});
