import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { ChevronLeft, ChevronRight, Crosshair, GitCompareArrows, Redo2, Trash2, Undo2 } from "lucide-react";
import { api } from "./api";
import { circuitFingerprint, shortFingerprint, simulationFingerprint, stimulusFingerprint } from "./fingerprint";
import { nodeTypes } from "./GateNode";
import { WaveformPanel } from "./WaveformPanel";
import { findFirstDifference, valueAtTime } from "./compareUtils";
import type {
  Circuit,
  CircuitNode,
  ExampleSummary,
  GateType,
  LogicValue,
  SavedCircuit,
  SavedSummary,
  SimulationResult,
  Stimulus,
  StimulusEvent,
  StimulusPlan,
} from "./types";

const gateTypes: GateType[] = ["INPUT", "NOT", "BUFFER", "AND", "OR", "XOR", "NAND", "NOR", "XNOR"];
const nodeCounter = { value: 0 };

type LoadedPayload = {
  name?: string;
  circuit: Circuit;
  stimulus?: Stimulus;
  plans?: StimulusPlan[];
  activePlanId?: string;
  comparePlanId?: string;
  maxTime?: number;
  cursorTime?: number | null;
  baseline?: Baseline | null;
};
type RunRecord = { fingerprint: string; status: "running" | "ready" | "error"; result?: SimulationResult; error?: string };
type Snapshot = {
  nodes: Node[];
  edges: Edge[];
  plans: StimulusPlan[];
  activePlanId: string;
};

type Baseline = {
  label: string;
  fingerprint: string;
  circuitFingerprint: string;
  stimulusFingerprint: string;
  planId: string;
  planName: string;
  planVersion: number;
  maxTime: number;
  result: SimulationResult;
};

const RESULTS_WIDTH_KEY = "results-panel-width";
const RESULTS_COLLAPSED_KEY = "results-panel-collapsed";

function readStoredWidth(): number {
  const value = Number(localStorage.getItem(RESULTS_WIDTH_KEY));
  return Number.isFinite(value) ? Math.min(720, Math.max(300, value)) : 420;
}

function readStoredCollapsed(): boolean {
  return localStorage.getItem(RESULTS_COLLAPSED_KEY) === "1";
}

function baselineFromPayload(payload: LoadedPayload): Baseline | null {
  const stored = payload.baseline;
  const result = stored?.result;
  if (!stored || !result || typeof stored.fingerprint !== "string" || result.fingerprint !== stored.fingerprint) return null;
  if (typeof stored.circuitFingerprint !== "string" || typeof stored.stimulusFingerprint !== "string") return null;
  if (result.circuitFingerprint !== stored.circuitFingerprint || result.stimulusFingerprint !== stored.stimulusFingerprint) return null;
  const planId = String(stored.planId ?? "");
  return {
    label: String(stored.label ?? "锁定基线"),
    fingerprint: stored.fingerprint,
    circuitFingerprint: stored.circuitFingerprint,
    stimulusFingerprint: stored.stimulusFingerprint,
    planId,
    planName: String(stored.planName ?? planId),
    planVersion: Number(stored.planVersion ?? 1),
    maxTime: Number.isFinite(Number(stored.maxTime)) ? Number(stored.maxTime) : Number(result.maxTime ?? 160),
    result,
  };
}

function toCircuit(nodes: Node[], edges: Edge[]): Circuit {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: (node.data.type as GateType) ?? "BUFFER",
      label: String(node.data.label ?? node.id),
      delay: Number(node.data.delay ?? 10),
      initial: (node.data.initial as LogicValue) ?? 0,
      position: { x: node.position.x, y: node.position.y },
    })) as CircuitNode[],
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      targetPort: edge.targetHandle ?? "in",
    })),
  };
}

function toFlow(circuit: Circuit) {
  return {
    nodes: circuit.nodes.map((node) => ({
      id: node.id,
      type: "gate" as const,
      position: node.position ?? { x: 80, y: 80 },
      selected: false,
      data: { type: node.type, label: node.label, delay: node.delay, initial: node.initial },
    })),
    edges: circuit.edges.map((edge, index) => ({
      id: edge.id ?? `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      targetHandle: edge.targetPort,
      sourceHandle: "out",
      label: edge.targetPort,
    })),
  };
}

function planToStimulus(plan: StimulusPlan): Stimulus {
  return { initial: plan.initial ?? {}, events: plan.events };
}

function normalizePlans(payload: LoadedPayload): { plans: StimulusPlan[]; activePlanId: string } {
  if (payload.plans?.length) {
    const plans = payload.plans.map((plan, index) => ({
      id: plan.id || `plan-${index + 1}`,
      name: plan.name || `方案 ${index + 1}`,
      version: Number(plan.version || 1),
      initial: plan.initial ?? {},
      events: plan.events ?? [],
    }));
    return { plans, activePlanId: plans.some((plan) => plan.id === payload.activePlanId) ? payload.activePlanId! : plans[0].id };
  }
  return {
    plans: [{
      id: "plan-1",
      name: "方案 A",
      version: 1,
      initial: payload.stimulus?.initial ?? {},
      events: payload.stimulus?.events ?? [],
    }],
    activePlanId: "plan-1",
  };
}

export function App() {
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [savedList, setSavedList] = useState<SavedSummary[]>([]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [plans, setPlans] = useState<StimulusPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState("plan-1");
  const [comparePlanId, setComparePlanId] = useState<string>("");
  const [maxTime, setMaxTime] = useState(160);
  const [runs, setRuns] = useState<Record<string, RunRecord>>({});
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [circuitName, setCircuitName] = useState("未命名电路");
  const [savedId, setSavedId] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [resultsWidth, setResultsWidth] = useState(readStoredWidth);
  const [resultsCollapsed, setResultsCollapsed] = useState(readStoredCollapsed);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const loadTokenRef = useRef(0);
  const autoRunRef = useRef<{ token: number; planId: string; alsoCompare?: string } | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  const circuit = useMemo(() => toCircuit(nodes, edges), [nodes, edges]);
  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? plans[0] ?? null,
    [plans, activePlanId],
  );
  const comparePlan = useMemo(
    () => plans.find((plan) => plan.id === comparePlanId) ?? null,
    [plans, comparePlanId],
  );
  const stimulus: Stimulus = useMemo(() => activePlan ? planToStimulus(activePlan) : { events: [] }, [activePlan]);
  const inputs = useMemo(() => circuit.nodes.filter((node) => node.type === "INPUT"), [circuit.nodes]);
  const fingerprint = useMemo(
    () => (nodes.length && activePlan ? simulationFingerprint(circuit, stimulus, maxTime) : ""),
    [activePlan, circuit, stimulus, maxTime, nodes.length],
  );
  const circuitFingerprintValue = useMemo(() => (nodes.length ? circuitFingerprint(circuit) : ""), [circuit, nodes.length]);
  const currentRun = fingerprint ? runs[fingerprint] : undefined;
  const result = currentRun?.status === "ready" ? currentRun.result ?? null : null;
  const running = currentRun?.status === "running";
  const currentError = currentRun?.status === "error" ? currentRun.error ?? "" : "";

  const refreshSaved = useCallback(() => {
    api.saved().then((payload) => setSavedList(payload.circuits)).catch(() => undefined);
  }, []);

  useEffect(() => {
    api.examples().then((payload) => setExamples(payload.examples)).catch(() => undefined);
    refreshSaved();
  }, [refreshSaved]);

  const bumpHistory = useCallback(() => setHistoryVersion((value) => value + 1), []);

  const snapshot = useCallback((): Snapshot => ({
    nodes,
    edges,
    plans: plans.map((plan) => ({ ...plan, initial: { ...plan.initial }, events: [...plan.events] })),
    activePlanId,
  }), [nodes, edges, plans, activePlanId]);

  const commitHistory = useCallback(() => {
    historyRef.current.push(snapshot());
    if (historyRef.current.length > 100) historyRef.current.shift();
    futureRef.current = [];
    bumpHistory();
  }, [snapshot, bumpHistory]);

  const invalidate = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const restoreSnapshot = useCallback((next: Snapshot) => {
    setNodes(next.nodes);
    setEdges(next.edges);
    setPlans(next.plans);
    setActivePlanId(next.activePlanId);
    setComparePlanId("");
    setSavedId(undefined);
    invalidate();
  }, [setNodes, setEdges, invalidate]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(snapshot());
    restoreSnapshot(previous);
    bumpHistory();
  }, [snapshot, restoreSnapshot, bumpHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(snapshot());
    restoreSnapshot(next);
    bumpHistory();
  }, [snapshot, restoreSnapshot, bumpHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable);
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const runCircuit = useCallback(async (targetPlan?: StimulusPlan) => {
    const requestPlan = targetPlan ?? activePlan;
    if (!circuit.nodes.length || !requestPlan) return;
    const requestStimulus = planToStimulus(requestPlan);
    const expectedFingerprint = simulationFingerprint(circuit, requestStimulus, maxTime);
    const expectedCircuit = circuitFingerprint(circuit);
    const expectedStimulus = stimulusFingerprint(requestStimulus);
    setRuns((current) => ({
      ...current,
      [expectedFingerprint]: { fingerprint: expectedFingerprint, status: "running" },
    }));
    try {
      const payload = await api.simulate(circuit, requestStimulus, maxTime);
      const accepted = payload.fingerprint === expectedFingerprint
        && payload.circuitFingerprint === expectedCircuit
        && payload.stimulusFingerprint === expectedStimulus;
      if (!accepted) {
        setRuns((current) => ({
          ...current,
          [expectedFingerprint]: { fingerprint: expectedFingerprint, status: "error", error: "仿真结果与当前电路/方案组合不一致，已丢弃。" },
        }));
        return;
      }
      setRuns((current) => ({
        ...current,
        [expectedFingerprint]: { fingerprint: expectedFingerprint, status: "ready", result: payload },
      }));
    } catch (reason) {
      setRuns((current) => ({
        ...current,
        [expectedFingerprint]: { fingerprint: expectedFingerprint, status: "error", error: reason instanceof Error ? reason.message : String(reason) },
      }));
    }
  }, [activePlan, circuit, maxTime]);

  const applyPayload = useCallback((payload: LoadedPayload, id: string | undefined, autoRun: boolean, expectedToken?: number) => {
    if (expectedToken !== undefined && expectedToken !== loadTokenRef.current) return;
    if (!payload.circuit?.nodes?.length) {
      return;
    }
    const loadToken = expectedToken ?? loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    const flow = toFlow(payload.circuit);
    const loadedPlans = normalizePlans(payload);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setPlans(loadedPlans.plans);
    setActivePlanId(loadedPlans.activePlanId);
    const restoredCompare = loadedPlans.plans.some((plan) => plan.id === payload.comparePlanId) && payload.comparePlanId !== loadedPlans.activePlanId
      ? payload.comparePlanId!
      : "";
    setComparePlanId(restoredCompare);
    setCircuitName(payload.name ?? "未命名电路");
    setSavedId(id);
    setBaseline(baselineFromPayload(payload));
    setRuns({});
    if (typeof payload.maxTime === "number" && payload.maxTime > 0) setMaxTime(payload.maxTime);
    setCursorTime(typeof payload.cursorTime === "number" && payload.cursorTime >= 0 ? payload.cursorTime : null);
    setRevision((value) => value + 1);
    setReady(true);
    historyRef.current = [];
    futureRef.current = [];
    bumpHistory();
    const maxCounter = flow.nodes.reduce((max, node) => {
      const match = /\d+$/.exec(node.id);
      return Math.max(max, match ? Number(match[0]) : 0);
    }, 0);
    nodeCounter.value = Math.max(nodeCounter.value, maxCounter);
    if (autoRun) {
      const loadedPlan = loadedPlans.plans.find((plan) => plan.id === loadedPlans.activePlanId)!;
      autoRunRef.current = { token: loadToken, planId: loadedPlan.id, alsoCompare: restoredCompare || undefined };
    }
  }, [bumpHistory, setEdges, setNodes]);

  const applyLoadFailure = (token: number, reason: unknown) => {
    if (loadTokenRef.current === token) {
      console.error(reason);
    }
  };

  const loadExample = useCallback(async (id: string) => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    try {
      applyPayload(await api.example(id), undefined, true, token);
    } catch (reason) {
      applyLoadFailure(token, reason);
    }
  }, [applyPayload]);

  const loadSaved = useCallback(async (id: string) => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    try {
      applyPayload(await api.load(id), id, true, token);
    } catch (reason) {
      applyLoadFailure(token, reason);
    }
  }, [applyPayload]);

  useEffect(() => {
    let cancelled = false;
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    api.example("combinational").then((example) => {
      if (!cancelled) applyPayload(example, undefined, true, token);
    }).catch((reason) => {
      if (!cancelled && loadTokenRef.current === token) {
        console.error(reason);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const pending = autoRunRef.current;
    if (!pending || pending.token !== loadTokenRef.current || !nodes.length) return;
    autoRunRef.current = null;
    const loadedPlan = plans.find((plan) => plan.id === pending.planId) ?? plans[0];
    const otherPlan = pending.alsoCompare ? plans.find((plan) => plan.id === pending.alsoCompare) : undefined;
    if (loadedPlan) void runCircuit(loadedPlan).then(() => { if (otherPlan) void runCircuit(otherPlan); });
  });

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (changes.some((change) => change.type === "remove")) commitHistory();
    onNodesChangeBase(changes);
    if (changes.some((change) => change.type === "remove")) invalidate();
  }, [commitHistory, invalidate, onNodesChangeBase]);

  const onEdgesChange = useCallback((changes: Parameters<typeof onEdgesChangeBase>[0]) => {
    if (changes.some((change) => change.type === "remove")) commitHistory();
    onEdgesChangeBase(changes);
    if (changes.some((change) => change.type === "remove")) invalidate();
  }, [commitHistory, invalidate, onEdgesChangeBase]);

  const onConnect = useCallback((connection: Connection) => {
    commitHistory();
    invalidate();
    setEdges((current) => addEdge({ ...connection, sourceHandle: "out", label: connection.targetHandle }, current));
  }, [commitHistory, invalidate, setEdges]);

  const addNode = (type: GateType) => {
    commitHistory();
    invalidate();
    nodeCounter.value += 1;
    const id = `${type.toLowerCase()}${nodeCounter.value}`;
    setNodes((current) => [...current, {
      id,
      type: "gate",
      position: { x: 80 + (current.length % 5) * 40, y: 80 + (current.length % 5) * 36 },
      data: { type, label: id, delay: type === "INPUT" ? 0 : 10, initial: 0 },
    }]);
  };

  const selected = nodes.find((node) => node.selected);
  const updateSelected = (patch: Record<string, unknown>) => {
    if (!selected) return;
    const affectsSimulation = Object.keys(patch).some((key) => key !== "label");
    if (affectsSimulation) {
      commitHistory();
      invalidate();
    }
    setNodes((current) => current.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const save = async () => {
    if (!activePlan) return;
    const saved = await api.save({
      name: circuitName,
      circuit,
      stimulus: planToStimulus(activePlan),
      plans,
      activePlanId,
      comparePlanId,
      maxTime,
      cursorTime,
      baseline,
    }, savedId);
    setSavedId(saved.id);
    setCircuitName(saved.name);
    refreshSaved();
  };

  const editActivePlan = (updater: (plan: StimulusPlan) => StimulusPlan) => {
    if (!activePlan) return;
    commitHistory();
    invalidate();
    setPlans((current) => current.map((plan) =>
      plan.id === activePlan.id ? { ...updater(plan), version: plan.version + 1 } : plan,
    ));
  };

  const renameActivePlan = (name: string) => {
    if (!activePlan) return;
    setPlans((current) => current.map((plan) => plan.id === activePlan.id ? { ...plan, name } : plan));
  };

  const addStimulus = () => {
    const firstInput = inputs[0]?.id;
    if (!firstInput) return;
    editActivePlan((plan) => ({
      ...plan,
      events: [...plan.events, { time: plan.events.at(-1)?.time ? plan.events.at(-1)!.time + 20 : 20, node: firstInput, value: 1 as LogicValue }],
    }));
  };

  const updateStimulus = (updater: (current: StimulusEvent[]) => StimulusEvent[]) =>
    editActivePlan((plan) => ({ ...plan, events: updater(plan.events) }));

  const updateInitial = (nodeId: string, value: LogicValue) => {
    editActivePlan((plan) => ({ ...plan, initial: { ...plan.initial, [nodeId]: value } }));
  };

  const duplicatePlan = () => {
    if (!activePlan) return;
    commitHistory();
    const copied: StimulusPlan = {
      ...activePlan,
      id: `plan-${Date.now()}`,
      name: `${activePlan.name} 副本`,
      version: 1,
      initial: { ...activePlan.initial },
      events: [...activePlan.events],
    };
    setPlans((current) => [...current, copied]);
    setActivePlanId(copied.id);
    setComparePlanId(activePlan.id);
    invalidate();
  };

  const selectPlan = (id: string) => {
    setActivePlanId(id);
    setComparePlanId((current) => (current === id ? "" : current));
  };

  const runComparedPlans = async () => {
    if (!activePlan) return;
    await runCircuit(activePlan);
    if (comparePlan) await runCircuit(comparePlan);
  };

  const disconnectSelected = () => {
    if (!edges.some((edge) => edge.selected)) return;
    commitHistory();
    invalidate();
    setEdges((current) => current.filter((edge) => !edge.selected));
  };

  const keepBaseline = useCallback(() => {
    if (!result || !activePlan || result.fingerprint !== fingerprint) return;
    setBaseline({
      label: `修订 #${revision} · ${activePlan.name} v${activePlan.version}`,
      fingerprint: result.fingerprint,
      circuitFingerprint: circuitFingerprintValue,
      stimulusFingerprint: stimulusFingerprint(stimulus),
      planId: activePlan.id,
      planName: activePlan.name,
      planVersion: activePlan.version,
      maxTime,
      result,
    });
  }, [result, activePlan, fingerprint, revision, circuitFingerprintValue, stimulus, maxTime]);

  const baselineCircuitMatches = baseline?.circuitFingerprint === circuitFingerprintValue;
  const baselinePlan = baseline ? plans.find((plan) => plan.id === baseline.planId) ?? null : null;
  const baselinePlanMatches = baseline ? {
    name: baselinePlan?.name === baseline.planName,
    version: baselinePlan?.version === baseline.planVersion,
    stimulus: baselinePlan ? stimulusFingerprint(planToStimulus(baselinePlan)) === baseline.stimulusFingerprint : false,
  } : null;
  const baselineStale = !!baseline && (
    !baselineCircuitMatches
    || !baselinePlan
    || !baselinePlanMatches?.name
    || !baselinePlanMatches?.version
    || !baselinePlanMatches?.stimulus
    || baseline.maxTime !== maxTime
  );


  const resultMatchesCurrent = result?.fingerprint === fingerprint;
  const resultForPlan = (plan: StimulusPlan) => {
    const key = simulationFingerprint(circuit, planToStimulus(plan), maxTime);
    const record = runs[key];
    return record?.status === "ready" ? record.result ?? null : null;
  };
  const compareResult = comparePlan ? resultForPlan(comparePlan) : null;
  const waveformBaseline = comparePlan && compareResult
    ? { label: `${comparePlan.name} v${comparePlan.version}`, fingerprint: compareResult.fingerprint, result: compareResult }
    : baseline;
  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const effectiveMaxTime = Math.max(result?.maxTime ?? 0, waveformBaseline?.result.maxTime ?? 0);
  const clampedCursorTime = cursorTime !== null && effectiveMaxTime > 0
    ? Math.max(0, Math.min(cursorTime, effectiveMaxTime))
    : null;

  const toggleResults = useCallback(() => {
    setResultsCollapsed((current) => {
      const next = !current;
      localStorage.setItem(RESULTS_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const onResultsResizeStart = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    resizeStartRef.current = { x: event.clientX, width: resultsWidth };
    const onMove = (moveEvent: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const nextWidth = Math.min(720, Math.max(300, start.width + (start.x - moveEvent.clientX)));
      setResultsWidth(nextWidth);
      localStorage.setItem(RESULTS_WIDTH_KEY, String(nextWidth));
    };
    const onUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("col-resizing");
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [resultsWidth]);

  const onResultsFocusIn = useCallback((event: ReactFocusEvent<HTMLElement>) => {
    event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  const firstDiff = useMemo(() => {
    if (!result) return null;
    if (comparePlan && compareResult) {
      const outputIds = Array.from(new Set([
        ...Object.keys(result.waveforms).filter((nodeId) => !inputs.some((input) => input.id === nodeId)),
        ...Object.keys(compareResult.waveforms).filter((nodeId) => !inputs.some((input) => input.id === nodeId)),
      ])).sort();
      return findFirstDifference(result, compareResult, outputIds);
    }
    if (!comparePlan && baseline) {
      const outputIds = Array.from(new Set([...Object.keys(result.waveforms), ...Object.keys(baseline.result.waveforms)])).sort();
      return findFirstDifference(result, baseline.result, outputIds);
    }
    return null;
  }, [result, comparePlan, compareResult, baseline, inputs]);

  return (
    <main className="app">
      <header>
        <div>
          <h1>数字电路设计平台</h1>
          <p>逻辑元件连线 · 事件驱动仿真 · 版本指纹与修订波形对照</p>
        </div>
        <div className="header-actions">
          <select value="" onChange={(event) => event.target.value && loadExample(event.target.value)}>
            <option value="">载入内置示例</option>
            {examples.map((example) => <option key={example.id} value={example.id}>{example.name}</option>)}
          </select>
          <button onClick={() => runComparedPlans()} disabled={running || !nodes.length || !activePlan}>{running ? "计算中…" : "运行方案"}</button>
        </div>
      </header>

      <section
        className="workspace"
        style={{ gridTemplateColumns: `280px minmax(0, 1fr) ${resultsCollapsed ? 0 : resultsWidth}px` }}
      >
        <aside className="sidebar">
          <h2>元件</h2>
          <div className="gate-buttons">{gateTypes.map((type) => <button key={type} onClick={() => addNode(type)}>+ {type}</button>)}</div>

          <h2>属性</h2>
          {selected ? (
            <div className="property-grid">
              <label>名称<input value={String(selected.data.label ?? "")} onChange={(e) => updateSelected({ label: e.target.value })} /></label>
              <label>延迟(ns)<input type="number" min={0} value={Number(selected.data.delay ?? 0)} onChange={(e) => updateSelected({ delay: Number(e.target.value) })} /></label>
              <label>初值<select value={String(selected.data.initial ?? 0)} onChange={(e) => updateSelected({ initial: e.target.value === "x" ? "x" : Number(e.target.value) })}><option value="0">0</option><option value="1">1</option><option value="x">X</option></select></label>
            </div>
          ) : <p className="hint">选择元件后可改名称、传播延迟和初值。</p>}

          <h2>激励方案</h2>
          {activePlan && (
            <div className="plan-editor">
              <select value={activePlanId} onChange={(event) => selectPlan(event.target.value)}>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} v{plan.version}</option>)}
              </select>
              <input value={activePlan.name} onChange={(event) => renameActivePlan(event.target.value)} />
              <div className="plan-actions">
                <button onClick={duplicatePlan}>复制方案</button>
              </div>
              <h3>输入初值（t=0 生效）</h3>
              <div className="initial-grid">
                {inputs.length ? inputs.map((input) => (
                  <label key={input.id}>{input.id}
                    <select value={String(activePlan.initial?.[input.id] ?? input.initial ?? 0)} onChange={(e) => updateInitial(input.id, e.target.value === "x" ? "x" : Number(e.target.value) as LogicValue)}>
                      <option value="0">0</option><option value="1">1</option><option value="x">X</option>
                    </select>
                  </label>
                )) : <p className="hint">添加 INPUT 元件。</p>}
              </div>
              <h3>跳变（同一时刻可多选输入同时变化）</h3>
              <div className="events-editor">
                {activePlan.events.map((event, index) => (
                  <div className="event-row" key={`${index}-${event.node}`}>
                    <input type="number" value={event.time} onChange={(e) => updateStimulus((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, time: Number(e.target.value) } : item))} />
                    <select value={event.node} onChange={(e) => updateStimulus((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, node: e.target.value } : item))}>
                      {inputs.map((input) => <option key={input.id} value={input.id}>{input.id}</option>)}
                    </select>
                    <select value={String(event.value)} onChange={(e) => updateStimulus((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: e.target.value === "x" ? "x" : Number(e.target.value) as LogicValue } : item))}>
                      <option value="0">0</option><option value="1">1</option><option value="x">X</option>
                    </select>
                    <button onClick={() => updateStimulus((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={addStimulus} disabled={!inputs.length}>添加跳变</button>
              </div>
            </div>
          )}

          <h2>保存 / 读取</h2>
          <div className="save-row">
            <input value={circuitName} onChange={(e) => setCircuitName(e.target.value)} />
            <button onClick={save}>保存</button>
          </div>
          <div className="saved-list">{savedList.map((item) => <button key={item.id} onClick={() => loadSaved(item.id)}>{item.name}</button>)}</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)"><Undo2 size={15} /></button>
            <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
            <label>观测窗口<input type="number" value={maxTime} min={1} onChange={(e) => { invalidate(); setMaxTime(Number(e.target.value)); }} /> ns</label>
            <button onClick={disconnectSelected}>断开选中连线</button>
            <span className="revision">
              修订 #{revision} · 指纹 {fingerprint ? shortFingerprint(fingerprint) : "—"} · 
              {running ? "计算中" : currentRun?.status === "error" ? "结果被拒绝" : result ? "结果属于当前电路/方案" : "尚未运行"}
            </span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            deleteKeyCode={canvasFocused ? ["Delete", "Backspace"] : null}
            onFocus={() => setCanvasFocused(true)}
            onBlur={() => setCanvasFocused(false)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </section>

        <aside
          className={`results${resultsCollapsed ? " collapsed" : ""}`}
          aria-hidden={resultsCollapsed}
          ref={(element) => { resultsRef.current = element; }}
          onFocusCapture={onResultsFocusIn}
          tabIndex={-1}
        >
          {!resultsCollapsed && (
            <>
              <div className="results-sticky">
                <div className="results-sticky-row">
                  <h2>仿真状态</h2>
                  <button
                    type="button"
                    className="collapse-button"
                    onClick={toggleResults}
                    title="折叠结果面板"
                    aria-label="折叠结果面板"
                  ><ChevronRight size={15} /></button>
                </div>
                {currentError && <div className="error">{currentError}</div>}
                {!ready && <div className="empty-panel">正在载入首个示例，空画布不会被提交。</div>}
                {result ? <StatusCard result={result} current={resultMatchesCurrent} activePlan={activePlan} circuitFingerprint={circuitFingerprintValue} />
                  : running ? <div className="empty-panel">当前电路/方案组合计算中，旧结果不会写入诊断、事件或稳定状态。</div>
                  : ready ? <div className="empty-panel">尚未运行。</div> : null}
              </div>

              <div className="results-sticky compare-sticky">
                <h2>方案 / 修订波形对照</h2>
                <div className="compare-controls">
                  <select value={comparePlanId} onChange={(event) => setComparePlanId(event.target.value)} aria-label="选择用于比较的输入方案">
                    <option value="">不比较其他方案（使用锁定基线）</option>
                    {plans.filter((plan) => plan.id !== activePlanId).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} v{plan.version}</option>)}
                  </select>
                  <button onClick={keepBaseline} disabled={!result || !resultMatchesCurrent}><GitCompareArrows size={14} /> 锁定电路修订基线</button>
                  <button onClick={() => setBaseline(null)} disabled={!baseline}>清除修订基线</button>
                </div>
                {baseline && (
                  <div className={`baseline-meta${baselineStale ? " stale" : ""}`}>
                    {baselineStale ? "已锁定基线与当前电路/方案不再对应：" : "已锁定基线对应："}
                    电路 {shortFingerprint(baseline.circuitFingerprint)} · 方案「{baseline.planName}」v{baseline.planVersion}
                    （{shortFingerprint(baseline.stimulusFingerprint)}）· 窗口 {baseline.maxTime} ns · 结果 {shortFingerprint(baseline.fingerprint)}
                  </div>
                )}
                {comparePlan && (
                  <div className="baseline-meta">
                    比较中的输入方案：「{comparePlan.name}」v{comparePlan.version}（{shortFingerprint(stimulusFingerprint(planToStimulus(comparePlan))) }）
                    {!compareResult && <span> — 尚未在当前电路修订上运行；点击“运行方案”。</span>}
                  </div>
                )}
                {waveformBaseline && !comparePlan && (
                  <div className="baseline-meta">虚线基线：{baseline!.label}（{shortFingerprint(waveformBaseline.fingerprint)}）</div>
                )}
              </div>
              {firstDiff && (
                <button
                  type="button"
                  className="locate-diff"
                  onClick={() => setCursorTime(firstDiff.time)}
                ><Crosshair size={14} /> 定位首个差异：t={firstDiff.time}，节点 {firstDiff.nodeId}</button>
              )}
              <WaveformPanel
                result={result}
                baseline={waveformBaseline}
                cursorTime={clampedCursorTime}
                diffTime={firstDiff?.time ?? null}
                onCursorTimeChange={setCursorTime}
              />
              <PlanDiff current={result} currentPlan={activePlan} compare={compareResult} comparePlan={comparePlan} inputIds={inputs.map((input) => input.id)} onLocate={(time) => setCursorTime(time)} />
              {!comparePlan && <RevisionDiff current={result} baseline={baseline} onLocate={(time) => setCursorTime(time)} />}
              <h2>实际事件</h2>
              <div className="log-list">{result?.events.map((event, index) => (
                <button
                  type="button"
                  key={index}
                  className={`log-row${clampedCursorTime === event.time ? " active" : ""}`}
                  onClick={() => setCursorTime(event.time)}
                ><b>t={event.time}</b> {event.node} → {String(event.value)} <span>{event.reason}</span></button>
              ))}</div>
              <h2>诊断</h2>
              <div className="diagnostics">{result?.diagnostics.map((item, index) => <div key={index} className={item.severity}>t={item.time} {item.message}</div>)}{result && !result.diagnostics.length && <div className="ok">无断连或争用</div>}</div>
            </>
          )}
        </aside>
        {resultsCollapsed && (
          <button
            type="button"
            className="results-expand"
            onClick={toggleResults}
            title="展开结果面板"
            aria-label="展开结果面板"
          ><ChevronLeft size={16} /><span>结果面板</span></button>
        )}
        {!resultsCollapsed && (
          <div
            className="results-resizer"
            style={{ right: resultsWidth - 4.5 }}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整结果面板宽度"
            tabIndex={0}
            onPointerDown={onResultsResizeStart}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 24 : -24;
              setResultsWidth((current) => {
                const next = Math.min(720, Math.max(300, current + delta));
                localStorage.setItem(RESULTS_WIDTH_KEY, String(next));
                return next;
              });
            }}
          />
        )}
      </section>
    </main>
  );
}

function StatusCard({
  result,
  current,
  activePlan,
  circuitFingerprint,
}: {
  result: SimulationResult;
  current: boolean;
  activePlan: StimulusPlan | null;
  circuitFingerprint: string;
}) {
  const text = result.status === "stable" ? "已稳定" : result.status === "oscillating" ? "持续振荡" : "已截断";
  const circuitMatches = result.circuitFingerprint === circuitFingerprint;
  return (
    <div className={`status ${result.status}`}>
      <strong>{text}</strong>
      <span>所属电路 {shortFingerprint(result.circuitFingerprint ?? result.fingerprint)}{current && circuitMatches ? " · 与当前画布一致" : " · 与当前画布不一致"}</span>
      {activePlan && (
        <span>所属输入方案：「{activePlan.name}」v{activePlan.version}（{shortFingerprint(result.stimulusFingerprint ?? "")}）</span>
      )}
      <span>已处理 {result.processedEvents} 个事件；未处理 {result.pendingEvents} 个</span>
      {result.reason && <span>{result.reason}</span>}
    </div>
  );
}

function firstChangeTimes(result: SimulationResult): Record<string, Record<string, number>> {
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

function PlanDiff({
  current,
  currentPlan,
  compare,
  comparePlan,
  inputIds,
  onLocate,
}: {
  current: SimulationResult | null;
  currentPlan: StimulusPlan | null;
  compare: SimulationResult | null;
  comparePlan: StimulusPlan | null;
  inputIds: string[];
  onLocate: (time: number) => void;
}) {
  if (!currentPlan || !comparePlan) return null;
  if (!current || !compare) {
    return <div className="empty-panel">运行两个方案后，显示首次输出差异及其之前的输入变化。</div>;
  }
  const outputIds = Array.from(new Set([
    ...Object.keys(current.waveforms).filter((nodeId) => !inputIds.includes(nodeId)),
    ...Object.keys(compare.waveforms).filter((nodeId) => !inputIds.includes(nodeId)),
  ])).sort();
  const first = findFirstDifference(current, compare, outputIds);
  const relevantInputs = Array.from(new Set([
    ...(first ? inputIds.filter((nodeId) => String(currentPlan.initial?.[nodeId] ?? "x") !== String(comparePlan.initial?.[nodeId] ?? "x")) : []),
    ...currentPlan.events.filter((event) => !first || event.time <= first.time).map((event) => event.node),
    ...comparePlan.events.filter((event) => !first || event.time <= first.time).map((event) => event.node),
  ])).sort();
  return (
    <div className="revision-diff">
      {first ? (
        <button type="button" className="locate-diff" onClick={() => onLocate(first.time)}>
          <Crosshair size={14} /> 首次输出差异：t={first.time}，节点 {first.nodeId}（点击在波形上定位）
        </button>
      ) : <div className="ok">观测窗口内输出没有差异</div>}
      <table>
        <thead><tr><th>t</th><th>输入</th><th>{currentPlan.name}</th><th>{comparePlan.name}</th></tr></thead>
        <tbody>
          {relevantInputs.map((nodeId) => {
            const left = currentPlan.events.filter((event) => event.node === nodeId && (!first || event.time <= first.time));
            const right = comparePlan.events.filter((event) => event.node === nodeId && (!first || event.time <= first.time));
            const leftInitial = currentPlan.initial?.[nodeId] !== undefined ? `0:${String(currentPlan.initial![nodeId])}` : "";
            const rightInitial = comparePlan.initial?.[nodeId] !== undefined ? `0:${String(comparePlan.initial![nodeId])}` : "";
            const leftText = [leftInitial, ...left.map((event) => `${event.time}:${String(event.value)}`)].filter(Boolean).join(" → ") || "—";
            const rightText = [rightInitial, ...right.map((event) => `${event.time}:${String(event.value)}`)].filter(Boolean).join(" → ") || "—";
            const timesForInput = Array.from(new Set([0, ...left.map((event) => event.time), ...right.map((event) => event.time)]));
            return <tr key={nodeId}><td>{timesForInput.join(", ")}</td><td>{nodeId}</td><td>{leftText}</td><td>{rightText}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function RevisionDiff({
  current,
  baseline,
  onLocate,
}: {
  current: SimulationResult | null;
  baseline: Baseline | null;
  onLocate: (time: number) => void;
}) {
  if (!current || !baseline) {
    return <div className="empty-panel">运行一个版本后，将其保存为基线；再改一个门延迟或一条连接并重新运行，即可叠加对照传播差异。</div>;
  }
  if (current.fingerprint === baseline.fingerprint) {
    return <div className="ok">两份修订内容相同，波形一致。</div>;
  }
  const currentTimes = firstChangeTimes(current);
  const baselineTimes = firstChangeTimes(baseline.result);
  const nodeIds = Array.from(new Set([...Object.keys(currentTimes), ...Object.keys(baselineTimes)])).sort();
  const rows = nodeIds.flatMap((nodeId) => {
    const values = Array.from(new Set([...Object.keys(currentTimes[nodeId] ?? {}), ...Object.keys(baselineTimes[nodeId] ?? {})]));
    return values.map((value) => {
      const baseTime = baselineTimes[nodeId]?.[value];
      const currentTime = currentTimes[nodeId]?.[value];
      const delta = baseTime === undefined || currentTime === undefined ? undefined : currentTime - baseTime;
      return { nodeId, value, baseTime, currentTime, delta };
    });
  }).filter((row) => row.delta !== 0 || row.baseTime === undefined || row.currentTime === undefined);
  const sameStatus = current.status === baseline.result.status;
  return (
    <div className="revision-diff">
      {(() => {
        const allNodeIds = Array.from(new Set([
          ...Object.keys(current.waveforms),
          ...Object.keys(baseline.result.waveforms),
        ])).sort();
        const firstDiffPoint = findFirstDifference(current, baseline.result, allNodeIds);
        return firstDiffPoint ? (
          <button type="button" className="locate-diff" onClick={() => onLocate(firstDiffPoint.time)}>
            <Crosshair size={14} /> 相对锁定基线的首个波形差异：t={firstDiffPoint.time}，节点 {firstDiffPoint.nodeId}
          </button>
        ) : current.fingerprint === baseline.fingerprint ? null : <div className="ok">观测窗口内波形没有差异</div>;
      })()}
      <div className={sameStatus ? "ok" : "contention"}>稳定性：基线 {baseline.result.status}，当前 {current.status}{sameStatus ? "（一致）" : "（发生变化）"}</div>
      <table>
        <thead><tr><th>节点</th><th>值</th><th>基线 t</th><th>当前 t</th><th>传播差</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.nodeId}-${row.value}-${index}`}>
              <td>{row.nodeId}</td><td>{row.value}</td>
              <td>{row.baseTime ?? "—"}</td><td>{row.currentTime ?? "—"}</td>
              <td className={row.delta === undefined ? "" : row.delta > 0 ? "later" : "earlier"}>
                {row.delta === undefined ? "新增/消失" : row.delta > 0 ? `+${row.delta}` : row.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="ok">跳变时刻没有差异。</div>}
    </div>
  );
}
