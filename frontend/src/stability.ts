import type { SimulationResult } from "./types";

export type StabilityBehavior = "settles" | "oscillates" | "unknown";
export type StabilityObservation = "complete" | "truncated" | "unknown";

export type StabilityInterpretation = {
  behavior: StabilityBehavior;
  observation: StabilityObservation;
  settledTime: number | null | undefined;
};

export type StabilityComparison = {
  kind: "same" | "observation-only" | "changed" | "indeterminate";
  behaviorLabel: string;
  message: string;
};

export function interpretStability(result: Pick<SimulationResult, "status" | "settledTime">): StabilityInterpretation {
  if (result.status === "stable") {
    return { behavior: "settles", observation: "complete", settledTime: result.settledTime };
  }
  if (result.status === "window_exceeded") {
    return { behavior: "settles", observation: "truncated", settledTime: result.settledTime };
  }
  if (result.status === "oscillating") {
    return { behavior: "oscillates", observation: "complete", settledTime: null };
  }
  return { behavior: "unknown", observation: "unknown", settledTime: result.settledTime };
}

export function behaviorLabel(behavior: StabilityBehavior): string {
  if (behavior === "settles") return "最终稳定";
  if (behavior === "oscillates") return "持续振荡";
  return "稳定性无法判定";
}

export function observationLabel(observation: StabilityObservation): string {
  if (observation === "complete") return "观察足以覆盖该稳定性结论";
  if (observation === "truncated") return "观察窗口不足，事件未在当前窗口内逐笔显示";
  return "观察不足，结论无法判定";
}

export function compareStability(
  baseline: Pick<SimulationResult, "status" | "settledTime">,
  current: Pick<SimulationResult, "status" | "settledTime">,
): StabilityComparison {
  const left = interpretStability(baseline);
  const right = interpretStability(current);
  const label = behaviorLabel(right.behavior);
  if (left.behavior === "unknown" || right.behavior === "unknown") {
    return {
      kind: "indeterminate",
      behaviorLabel: label,
      message: `稳定性无法统一判定：基线${behaviorLabel(left.behavior)}，当前${behaviorLabel(right.behavior)}；不能据此声称电路行为发生变化。`,
    };
  }

  if (left.behavior !== right.behavior) {
    return {
      kind: "changed",
      behaviorLabel: label,
      message: `电路稳定性发生变化：基线${behaviorLabel(left.behavior)}，当前${behaviorLabel(right.behavior)}。`,
    };
  }

  if (left.observation !== right.observation) {
    return {
      kind: "observation-only",
      behaviorLabel: label,
      message: `电路行为一致（${label}）；差异只来自观察覆盖范围，其中一侧窗口尚未观察完，不是稳定性发生变化。`,
    };
  }

  return {
    kind: "same",
    behaviorLabel: label,
    message: `稳定性一致（${label}）。`,
  };
}
