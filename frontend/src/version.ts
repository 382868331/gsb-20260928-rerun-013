import type { Circuit, Stimulus } from "./types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function canonicalRequest(circuit: Circuit, stimulus: Stimulus, maxTime: number): string {
  const inputIds = new Set(circuit.nodes.filter((node) => node.type === "INPUT").map((node) => node.id));
  const normalizedCircuit = {
    nodes: circuit.nodes
      .map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        delay: node.delay,
        initial: node.initial,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: circuit.edges
      .map((edge) => ({ source: edge.source, target: edge.target, targetPort: edge.targetPort }))
      .sort((left, right) => {
        const leftKey = [left.source, left.target, left.targetPort].join(":");
        const rightKey = [right.source, right.target, right.targetPort].join(":");
        return leftKey.localeCompare(rightKey);
      }),
  };
  const normalizedStimulus = {
    initial: Object.fromEntries(
      Object.entries(stimulus.initial ?? {})
        .filter(([nodeId]) => inputIds.has(nodeId))
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    events: stimulus.events
      .map((event) => ({ node: event.node, time: event.time, value: event.value }))
      .sort((left, right) => (left.time - right.time || left.node.localeCompare(right.node))),
  };
  return JSON.stringify(stableValue({
    maxTime,
    circuit: normalizedCircuit,
    stimulus: normalizedStimulus,
  }));
}

export async function requestFingerprint(circuit: Circuit, stimulus: Stimulus, maxTime: number): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRequest(circuit, stimulus, maxTime));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
