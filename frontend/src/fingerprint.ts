import type { Circuit, Stimulus } from "./types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function circuitFingerprint(circuit: Circuit, stimulus: Stimulus, maxTime: number): string {
  const content = {
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
      .sort((left, right) =>
        [left.source, left.target, left.targetPort].join("|").localeCompare(
          [right.source, right.target, right.targetPort].join("|"),
        ),
      ),
    events: [...stimulus.events]
      .sort((left, right) =>
        left.time - right.time
          || left.node.localeCompare(right.node)
          || String(left.value).localeCompare(String(right.value)),
      )
      .map((event) => ({ time: event.time, node: event.node, value: event.value })),
    maxTime,
  };
  return JSON.stringify(stableValue(content));
}

export function shortFingerprint(fingerprint: string): string {
  let hash = 5381;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = ((hash << 5) + hash + fingerprint.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
