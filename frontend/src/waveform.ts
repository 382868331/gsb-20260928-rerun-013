import type { LogicValue, SimulationResult } from "./types";

export type WaveformSelection = {
  time: number;
  nodeId: string;
  fingerprint: string;
  reason: string;
};

export type ViewState = {
  maxTime: number;
  cursorTime: number;
  zoom: number;
  panelWidth: number;
  resultsCollapsed: boolean;
  selection: WaveformSelection | null;
};

export const defaultViewState: ViewState = {
  maxTime: 160,
  cursorTime: 0,
  zoom: 1,
  panelWidth: 390,
  resultsCollapsed: false,
  selection: null,
};

export function valueAtTime(trace: Array<{ time: number; value: LogicValue }> | undefined, time: number): LogicValue {
  if (!trace?.length) return "x";
  let value = trace[0].value;
  for (const point of trace) {
    if (point.time <= time) value = point.value;
  }
  return value;
}

export function firstChangeTimes(result: SimulationResult): Record<string, Record<string, number>> {
  const times: Record<string, Record<string, number>> = {};
  for (const [nodeId, trace] of Object.entries(result.waveforms)) {
    times[nodeId] = {};
    for (const point of trace) {
      if (point.time === 0) continue;
      const key = String(point.value);
      if (times[nodeId][key] === undefined) times[nodeId][key] = point.time;
    }
  }
  return times;
}

export function findFirstWaveformDifference(
  current: SimulationResult,
  comparison: SimulationResult,
  excludedNodeIds: string[] = [],
): WaveformSelection | null {
  const excluded = new Set(excludedNodeIds);
  const nodeIds = Array.from(new Set([
    ...Object.keys(current.waveforms),
    ...Object.keys(comparison.waveforms),
  ])).filter((nodeId) => !excluded.has(nodeId)).sort();
  const times = Array.from(new Set([
    ...Object.values(current.waveforms).flatMap((trace) => trace.map((point) => point.time)),
    ...Object.values(comparison.waveforms).flatMap((trace) => trace.map((point) => point.time)),
  ])).sort((left, right) => left - right);
  const match = times.flatMap((time) => nodeIds.map((nodeId) => ({ time, nodeId })))
    .find(({ time, nodeId }) => String(valueAtTime(current.waveforms[nodeId], time)) !== String(valueAtTime(comparison.waveforms[nodeId], time)));
  return match ? {
    time: match.time,
    nodeId: match.nodeId,
    fingerprint: current.fingerprint,
    reason: "波形首次差异",
  } : null;
}

export function normalizeViewState(value: Partial<ViewState> | undefined | null): ViewState {
  const numeric = (raw: unknown, fallback: number, min: number, max: number) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const rawSelection = value?.selection;
  const selection = rawSelection
    && Number.isFinite(Number(rawSelection.time))
    && typeof rawSelection.nodeId === "string"
    && typeof rawSelection.fingerprint === "string"
    ? {
        time: Math.max(0, Number(rawSelection.time)),
        nodeId: rawSelection.nodeId,
        fingerprint: rawSelection.fingerprint,
        reason: typeof rawSelection.reason === "string" ? rawSelection.reason : "波形选择",
      }
    : null;
  return {
    maxTime: numeric(value?.maxTime, defaultViewState.maxTime, 1, 100000),
    cursorTime: Math.max(0, numeric(value?.cursorTime, defaultViewState.cursorTime, 0, 100000)),
    zoom: numeric(value?.zoom, defaultViewState.zoom, 1, 20),
    panelWidth: numeric(value?.panelWidth, defaultViewState.panelWidth, 300, 760),
    resultsCollapsed: Boolean(value?.resultsCollapsed),
    selection,
  };
}
