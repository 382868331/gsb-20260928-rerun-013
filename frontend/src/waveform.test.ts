import { describe, expect, it } from "vitest";
import { findFirstWaveformDifference, normalizeViewState } from "./waveform";
import type { SimulationResult } from "./types";

function result(fingerprint: string, maxTime: number, led: Array<{ time: number; value: 0 | 1 | "x" }>): SimulationResult {
  return {
    fingerprint,
    circuitFingerprint: "circuit",
    stimulusFingerprint: fingerprint,
    status: "stable",
    maxTime,
    processedEvents: led.length,
    pendingEvents: 0,
    changedNodes: ["led"],
    waveforms: { A: [{ time: 0, value: 0 }], led },
    events: [],
    diagnostics: [],
    finalValues: { A: 0, led: led.at(-1)?.value ?? "x" },
  };
}

describe("waveform comparisons and persisted view state", () => {
  it("locates the earliest output node difference", () => {
    const current = result("current", 100, [{ time: 0, value: 0 }, { time: 30, value: 1 }]);
    const comparison = result("comparison", 100, [{ time: 0, value: 0 }, { time: 20, value: 1 }]);

    expect(findFirstWaveformDifference(current, comparison, ["A"])).toEqual({
      time: 20,
      nodeId: "led",
      fingerprint: "current",
      reason: "波形首次差异",
    });
  });

  it("keeps an out-of-window cursor but clamps display bounds explicitly", () => {
    const view = normalizeViewState({
      maxTime: 80,
      cursorTime: 160,
      zoom: 30,
      panelWidth: 900,
      selection: { time: 160, nodeId: "led", fingerprint: "longer-window", reason: "波形首次差异" },
    });

    expect(view.cursorTime).toBe(160);
    expect(view.maxTime).toBe(80);
    expect(view.zoom).toBe(20);
    expect(view.panelWidth).toBe(760);
    expect(view.selection?.time).toBe(160);
  });
});
