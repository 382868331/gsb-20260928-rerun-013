import React from 'react';
import { Handle, Position } from '@xyflow/react';

const INPUTS = {
  AND: 2, OR: 2, XOR: 2, NAND: 2, NOR: 2, XNOR: 2,
  NOT: 1, BUF: 1, INPUT: 0, OUTPUT: 1,
};

function pins(n) {
  if (n === 0) return [];
  if (n === 1) return [50];
  return [30, 70];
}

export default function GateNode({ data, selected }) {
  const gtype = data.gtype;
  const n = INPUTS[gtype] ?? 1;
  const isInput = gtype === 'INPUT';
  const isOutput = gtype === 'OUTPUT';
  return (
    <div className={`gate-node ${selected ? 'selected' : ''} kind-${isInput ? 'in' : isOutput ? 'out' : 'gate'}`}>
      {Array.from({ length: n }).map((_, i) => (
        <Handle
          key={`in-${i}`}
          id={`in-${i}`}
          type="target"
          position={Position.Left}
          style={{ top: `${pins(n)[i]}%` }}
        />
      ))}
      <div className="gate-type">{gtype}</div>
      <div className="gate-label">{data.label}</div>
      {!isInput && !isOutput && <div className="gate-delay">Δ {data.delay}</div>}
      {isInput && (
        <div className="gate-stim">
          {data.stimulus && data.stimulus.length > 0 ? data.stimulus.map((s) => `@${s[0]}=${s[1]}`).join(' ') : `=${data.value ?? '0'}`}
        </div>
      )}
      {!isInput && (
        <Handle id="out" type="source" position={Position.Right} style={{ top: '50%' }} />
      )}
    </div>
  );
}
