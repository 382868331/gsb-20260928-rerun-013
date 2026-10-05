import type { SimulationResult } from "./types";

export type EffectiveStability = "stable" | "oscillating" | "unknown";

export type StabilityComparison = {
  sameBehavior: boolean;
  sameStability: boolean;
  windowOnly: boolean;
  settledTime: number | null;
  left: EffectiveStability;
  right: EffectiveStability;
};

export function statusLabel(status: SimulationResult["status"]): string {
  switch (status) {
    case "stable": return "已稳定";
    case "window_exceeded": return "观察窗口结束，仍有未来事件";
    case "oscillating": return "持续振荡";
    default: return "无法判定";
  }
}

export function effectiveStabilityLabel(stability: EffectiveStability): string {
  switch (stability) {
    case "stable": return "电路最终稳定";
    case "oscillating": return "电路持续振荡";
    default: return "稳定性无法判定";
  }
}

export function effectiveStability(result: Pick<SimulationResult, "status">): EffectiveStability {
  return result.status === "window_exceeded" ? "stable" : result.status;
}

export function resultSettledTime(result: Pick<SimulationResult, "status" | "settledTime">): number | null {
  if (result.status === "unknown" || result.status === "oscillating") return null;
  return result.settledTime ?? null;
}

export function sameCircuitBehavior(left: SimulationResult, right: SimulationResult): boolean {
  return Boolean(left.circuitFingerprint && right.circuitFingerprint)
    && left.circuitFingerprint === right.circuitFingerprint
    && Boolean(left.stimulusFingerprint && right.stimulusFingerprint)
    && left.stimulusFingerprint === right.stimulusFingerprint;
}

export function compareStability(left: SimulationResult, right: SimulationResult): StabilityComparison {
  const leftStability = effectiveStability(left);
  const rightStability = effectiveStability(right);
  const behaviorSame = sameCircuitBehavior(left, right);
  const leftSettled = resultSettledTime(left);
  const rightSettled = resultSettledTime(right);
  const sameStability = leftStability === rightStability;
  return {
    sameBehavior: behaviorSame,
    sameStability,
    windowOnly: behaviorSame && sameStability && left.status !== right.status,
    settledTime: leftSettled ?? rightSettled,
    left: leftStability,
    right: rightStability,
  };
}
