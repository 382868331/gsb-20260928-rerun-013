import { describe, expect, it } from "vitest";
import type { SimulationResult } from "./types";
import { compareStability, effectiveStability } from "./stability";

function makeResult(overrides: Partial<SimulationResult> & Pick<SimulationResult, "status" | "maxTime">): SimulationResult {
  return {
    fingerprint: `fp-${overrides.status}-${overrides.maxTime}`,
    circuitFingerprint: "circuit-1",
    stimulusFingerprint: "stimulus-1",
    settledTime: null,
    processedEvents: 0,
    pendingEvents: 0,
    changedNodes: [],
    waveforms: {},
    events: [],
    diagnostics: [],
    finalValues: {},
    ...overrides,
  };
}

describe("compareStability", () => {
  it("treats stable vs window_exceeded with same circuit as observation-only difference", () => {
    const wide = makeResult({ status: "stable", maxTime: 311, settledTime: 130, pendingEvents: 0 });
    const narrow = makeResult({ status: "window_exceeded", maxTime: 20, settledTime: 130, pendingEvents: 12 });
    const comparison = compareStability(wide, narrow);
    expect(effectiveStability(wide)).toBe("stable");
    expect(effectiveStability(narrow)).toBe("stable");
    expect(comparison.sameBehavior).toBe(true);
    expect(comparison.sameStability).toBe(true);
    expect(comparison.windowOnly).toBe(true);
    expect(comparison.settledTime).toBe(130);
  });

  it("keeps latch short and long windows as the same stability conclusion", () => {
    const wide = makeResult({ status: "stable", maxTime: 180, settledTime: 122 });
    const narrow = makeResult({ status: "window_exceeded", maxTime: 30, settledTime: 122, pendingEvents: 8 });
    expect(compareStability(narrow, wide)).toMatchObject({ sameBehavior: true, sameStability: true, windowOnly: true });
  });

  it("reports oscillator as oscillating in both short and long windows", () => {
    for (const maxTime of [20, 311]) {
      const result = makeResult({ status: "oscillating", maxTime, pendingEvents: 5 });
      expect(effectiveStability(result)).toBe("oscillating");
    }
    const comparison = compareStability(makeResult({ status: "oscillating", maxTime: 20 }), makeResult({ status: "oscillating", maxTime: 311 }));
    expect(comparison).toMatchObject({ sameBehavior: true, sameStability: true, windowOnly: false });
  });

  it("flags a real circuit revision that changes stability", () => {
    const before = makeResult({
      status: "stable",
      maxTime: 160,
      settledTime: 80,
      circuitFingerprint: "circuit-1",
    });
    const after = makeResult({
      status: "oscillating",
      maxTime: 160,
      circuitFingerprint: "circuit-2",
    });
    const comparison = compareStability(before, after);
    expect(comparison.sameBehavior).toBe(false);
    expect(comparison.sameStability).toBe(false);
    expect(comparison.windowOnly).toBe(false);
  });

  it("keeps stability equal for a different stimulus plan that also settles later", () => {
    const left = makeResult({ status: "stable", maxTime: 160, settledTime: 40, stimulusFingerprint: "plan-a" });
    const right = makeResult({ status: "stable", maxTime: 160, settledTime: 90, stimulusFingerprint: "plan-b" });
    const comparison = compareStability(left, right);
    expect(comparison.sameBehavior).toBe(false);
    expect(comparison.sameStability).toBe(true);
    expect(comparison.windowOnly).toBe(false);
  });
});
