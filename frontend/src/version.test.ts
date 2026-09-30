import { describe, expect, it } from "vitest";
import { canonicalRequest } from "./version";
import type { Circuit, Stimulus } from "./types";

const circuit: Circuit = {
  nodes: [
    { id: "B", type: "INPUT", label: "B", delay: 0, initial: 0, position: { x: 20, y: 20 } },
    { id: "A", type: "INPUT", label: "A", delay: 0, initial: 0, position: { x: 10, y: 10 } },
    { id: "or", type: "OR", label: "OR", delay: 10, initial: "x", position: { x: 60, y: 30 } },
  ],
  edges: [
    { id: "ignored", source: "B", target: "or", targetPort: "in2" },
    { id: "ignored-too", source: "A", target: "or", targetPort: "in1" },
  ],
};
const stimulus: Stimulus = {
  initial: { B: 1, unused: 1 as never },
  events: [{ time: 20, node: "A", value: 1 }],
};

describe("canonicalRequest", () => {
  it("ignores canvas positions and edge ids", () => {
    const moved: Circuit = {
      ...circuit,
      nodes: circuit.nodes.map((node) => node.id === "A" ? { ...node, position: { x: 99, y: 88 } } : node),
      edges: circuit.edges.map((edge) => ({ ...edge, id: "different" })),
    };
    expect(canonicalRequest(moved, stimulus, 100)).toBe(canonicalRequest(circuit, stimulus, 100));
  });

  it("changes when a gate delay or connection changes", () => {
    const delayed: Circuit = {
      ...circuit,
      nodes: circuit.nodes.map((node) => node.id === "or" ? { ...node, delay: 12 } : node),
    };
    const rewired: Circuit = {
      ...circuit,
      edges: circuit.edges.map((edge) => edge.source === "B" ? { ...edge, targetPort: "in1" } : edge),
    };
    expect(canonicalRequest(delayed, stimulus, 100)).not.toBe(canonicalRequest(circuit, stimulus, 100));
    expect(canonicalRequest(rewired, stimulus, 100)).not.toBe(canonicalRequest(circuit, stimulus, 100));
  });
});
