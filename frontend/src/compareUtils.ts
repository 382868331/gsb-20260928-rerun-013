import type { LogicValue } from "./types";

export function valueAtTime(
  trace: Array<{ time: number; value: LogicValue }>,
  time: number,
): LogicValue {
  let value: LogicValue = trace[0]?.value ?? "x";
  for (const point of trace) {
    if (point.time <= time) value = point.value;
  }
  return value;
}

export function findFirstDifference(
  current: { waveforms: Record<string, Array<{ time: number; value: LogicValue }>> },
  reference: { waveforms: Record<string, Array<{ time: number; value: LogicValue }>> },
  nodeIds: string[],
): { time: number; nodeId: string } | null {
  const times = Array.from(new Set([
    ...Object.values(current.waveforms).flatMap((trace) => trace.map((point) => point.time)),
    ...Object.values(reference.waveforms).flatMap((trace) => trace.map((point) => point.time)),
  ])).sort((left, right) => left - right);
  for (const time of times) {
    for (const nodeId of nodeIds) {
      const left = valueAtTime(current.waveforms[nodeId] ?? [{ time: 0, value: "x" }], time);
      const right = valueAtTime(reference.waveforms[nodeId] ?? [{ time: 0, value: "x" }], time);
      if (String(left) !== String(right)) return { time, nodeId };
    }
  }
  return null;
}
