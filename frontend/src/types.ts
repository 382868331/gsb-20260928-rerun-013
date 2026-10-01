export type LogicValue = 0 | 1 | "x";

export type GateType = "INPUT" | "NOT" | "BUFFER" | "AND" | "OR" | "XOR" | "NAND" | "NOR" | "XNOR";

export type CircuitNodeData = {
  type: GateType;
  label: string;
  delay: number;
  initial: LogicValue;
  [key: string]: unknown;
};

export type CircuitNode = {
  id: string;
  type: GateType;
  label: string;
  delay: number;
  initial: LogicValue;
  position: { x: number; y: number };
};

export type Circuit = {
  nodes: CircuitNode[];
  edges: Array<{ id?: string; source: string; target: string; targetPort: string }>;
};

export type StimulusEvent = { time: number; node: string; value: LogicValue };
export type StimulusPlan = {
  id: string;
  name: string;
  version: number;
  initial?: Record<string, LogicValue>;
  events: StimulusEvent[];
};
export type Stimulus = StimulusPlan & {
  plans?: StimulusPlan[];
  activePlanId?: string;
};

export type SimulationEvent = {
  time: number;
  node: string;
  value: LogicValue;
  reason: string;
};

export type Diagnostic = {
  time: number;
  severity: "disconnected" | "contention" | string;
  message: string;
};

export type SimulationResult = {
  fingerprint: string;
  planId: string;
  planName: string;
  planVersion: number;
  status: "stable" | "oscillating" | "truncated";
  maxTime: number;
  processedEvents: number;
  pendingEvents: number;
  changedNodes: string[];
  waveforms: Record<string, Array<{ time: number; value: LogicValue }>>;
  events: SimulationEvent[];
  diagnostics: Diagnostic[];
  finalValues: Record<string, LogicValue>;
  reason?: string;
};

export type ExampleSummary = { id: string; name: string; description: string };
export type SavedSummary = { id: string; name: string; updatedAt: number };
export type SavedCircuit = SavedSummary & { circuit: Circuit; stimulus: Stimulus };
