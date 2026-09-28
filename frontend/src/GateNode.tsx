import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CircuitNodeData } from "./types";

const inputPositions: Record<string, { top: string; id: string }> = {
  in: { top: "50%", id: "in" },
  in1: { top: "30%", id: "in1" },
  in2: { top: "70%", id: "in2" },
};

export function GateNode({ data, selected }: NodeProps) {
  const node = data as unknown as CircuitNodeData;
  const isInput = node.type === "INPUT";
  return (
    <div className={`gate ${isInput ? "input-gate" : "logic-gate"} ${selected ? "selected" : ""}`}>
      {Object.entries(inputPositions)
        .filter(([id]) => (node.type === "NOT" || node.type === "BUFFER" ? id === "in" : !isInput))
        .map(([id, placement]) => (
          <Handle
            key={id}
            id={id}
            type="target"
            position={Position.Left}
            style={{ top: placement.top }}
            title={id}
          />
        ))}
      <div className="gate-type">{node.type}</div>
      <div className="gate-label">{node.label}</div>
      <div className="gate-meta">{isInput ? `初值 ${node.initial}` : `${node.delay} ns`}</div>
      <Handle id="out" type="source" position={Position.Right} style={{ top: "50%" }} title="out" />
    </div>
  );
}

export const nodeTypes = { gate: GateNode };
