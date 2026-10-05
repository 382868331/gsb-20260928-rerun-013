import { describe, expect, it } from "vitest";

import { compareStability, interpretStability } from "./stability";

const results = {
  stable: { status: "stable", settledTime: 130 },
  shortWindow: { status: "window_exceeded", settledTime: 130 },
  oscillating: { status: "oscillating", settledTime: null },
  unknown: { status: "unknown", settledTime: null },
} as const;

describe("stability interpretation", () => {
  it("treats complete and truncated observation of settlement as the same circuit behavior", () => {
    expect(interpretStability(results.stable)).toMatchObject({ behavior: "settles", observation: "complete" });
    expect(interpretStability(results.shortWindow)).toMatchObject({ behavior: "settles", observation: "truncated" });

    const comparison = compareStability(results.stable, results.shortWindow);
    expect(comparison.kind).toBe("observation-only");
    expect(comparison.message).toContain("电路行为一致");
    expect(comparison.message).toContain("观察覆盖范围");
  });

  it("reports oscillator behavior consistently in short and long windows", () => {
    const comparison = compareStability(results.oscillating, results.oscillating);
    expect(comparison.kind).toBe("same");
    expect(comparison.behaviorLabel).toBe("持续振荡");
  });

  it("distinguishes a real behavior change from an observation gap", () => {
    const comparison = compareStability(results.stable, results.oscillating);
    expect(comparison.kind).toBe("changed");
    expect(comparison.message).toContain("电路稳定性发生变化");
  });

  it("does not call an indeterminate result a behavior change", () => {
    const comparison = compareStability(results.shortWindow, results.unknown);
    expect(comparison.kind).toBe("indeterminate");
    expect(comparison.message).toContain("不能据此声称电路行为发生变化");
  });
});
