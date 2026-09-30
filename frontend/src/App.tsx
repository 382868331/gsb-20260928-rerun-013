import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Trash2 } from "lucide-react";
import { api } from "./api";
import { nodeTypes } from "./GateNode";
import { WaveformPanel } from "./WaveformPanel";
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
} from "./types";
import { requestFingerprint } from "./version";

const gateTypes: GateType[] = ["INPUT", "NOT", "BUFFER", "AND", "OR", "XOR", "NAND", "NOR", "XNOR"];
const nodeCounter = { value: 0 };

type DocumentSnapshot = {
  nodes: Node[];
  edges: Edge[];
  stimulus: Stimulus;
  circuitName: string;
  savedId?: string;
};

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
      type: "gate",
      position: node.position ?? { x: 80, y: 80 },
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

export function App() {
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [savedList, setSavedList] = useState<SavedSummary[]>([]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [stimulus, setStimulus] = useState<Stimulus>({ initial: {}, events: [] });
  const [maxTime, setMaxTime] = useState(160);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [baselineResult, setBaselineResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [circuitName, setCircuitName] = useState("未命名电路");
  const [savedId, setSavedId] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const [undoStack, setUndoStack] = useState<DocumentSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocumentSnapshot[]>([]);
  const runId = useRef(0);
  const loadId = useRef(0);
  const circuit = useMemo(() => toCircuit(nodes, edges), [nodes, edges]);
  const stimulusEvents = stimulus.events;
  const inputs = useMemo(() => circuit.nodes.filter((node) => node.type === "INPUT"), [circuit.nodes]);

  useEffect(() => {
    api.examples().then((payload) => setExamples(payload.examples)).catch((reason) => setError(reason.message));
    refreshSaved();
  }, []);

  const refreshSaved = () => api.saved().then((payload) => setSavedList(payload.circuits)).catch(() => undefined);

  const invalidate = useCallback(() => {
    runId.current += 1;
    setRevision((value) => value + 1);
    setResult(null);
    setSavedId(undefined);
  }, []);

  const takeSnapshot = useCallback((): DocumentSnapshot => (
    { nodes, edges, stimulus, circuitName, savedId }
  ), [nodes, edges, stimulus, circuitName, savedId]);

  const beginChange = useCallback(() => {
    setUndoStack((current) => [...current.slice(-49), takeSnapshot()]);
    setRedoStack([]);
    invalidate();
  }, [invalidate, takeSnapshot]);

  const restoreSnapshot = useCallback((target: DocumentSnapshot, nextHistory: DocumentSnapshot[], nextFuture: DocumentSnapshot[]) => {
    runId.current += 1;
    setNodes(target.nodes);
    setEdges(target.edges);
    setStimulus(target.stimulus);
    setCircuitName(target.circuitName);
    setSavedId(target.savedId);
    setUndoStack(nextHistory);
    setRedoStack(nextFuture);
    setResult(null);
    setError("");
    setRevision((value) => value + 1);
  }, [setEdges, setNodes]);

  const undo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const snapshot = takeSnapshot();
    restoreSnapshot(previous, undoStack.slice(0, -1), [snapshot, ...redoStack]);
  }, [redoStack, restoreSnapshot, takeSnapshot, undoStack]);

  const redo = useCallback(() => {
    const next = redoStack[0];
    if (!next) return;
    const snapshot = takeSnapshot();
    restoreSnapshot(next, [...undoStack, snapshot], redoStack.slice(1));
  }, [redoStack, restoreSnapshot, takeSnapshot, undoStack]);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (changes.some((change) => change.type === "remove" || change.type === "add")) beginChange();
    onNodesChangeBase(changes);
  }, [beginChange, onNodesChangeBase]);

  const onConnect = useCallback((connection: Connection) => {
    beginChange();
    setEdges((current) => addEdge({ ...connection, sourceHandle: "out", label: connection.targetHandle }, current));
  }, [beginChange, setEdges]);

  const onEdgesChangeWithInvalidation = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    if (changes.some((change) => change.type === "remove" || change.type === "add")) beginChange();
    onEdgesChange(changes);
  }, [beginChange, onEdgesChange]);

  const loadPayload = (payload: { name?: string; circuit: Circuit; stimulus?: Stimulus }, id?: string) => {
    const flow = toFlow(payload.circuit);
    const loadedStimulus: Stimulus = {
      initial: payload.stimulus?.initial ?? {},
      events: payload.stimulus?.events ?? [],
    };
    const initialValues = loadedStimulus.initial ?? {};
    flow.nodes = flow.nodes.map((node) => (
      initialValues[node.id] === undefined
        ? node
        : { ...node, data: { ...node.data, initial: initialValues[node.id] } }
    ));
    runId.current += 1;
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setStimulus(loadedStimulus);
    setCircuitName(payload.name ?? "未命名电路");
    setSavedId(id);
    setResult(null);
    setBaselineResult(null);
    setError("");
    setUndoStack([]);
    setRedoStack([]);
    setRevision((value) => value + 1);
  };

  const loadExample = async (id: string) => {
    const currentLoad = loadId.current + 1;
    loadId.current = currentLoad;
    setLoading(true);
    setError("");
    try {
      const example = await api.example(id);
      if (loadId.current === currentLoad) loadPayload(example);
    } catch (reason) {
      if (loadId.current === currentLoad) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (loadId.current === currentLoad) setLoading(false);
    }
  };

  const loadSaved = async (id: string) => {
    const currentLoad = loadId.current + 1;
    loadId.current = currentLoad;
    setLoading(true);
    setError("");
    try {
      const saved = await api.load(id);
      if (loadId.current === currentLoad) loadPayload(saved, id);
    } catch (reason) {
      if (loadId.current === currentLoad) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (loadId.current === currentLoad) setLoading(false);
    }
  };

  const addNode = (type: GateType) => {
    nodeCounter.value += 1;
    const id = `${type.toLowerCase()}${nodeCounter.value}`;
    setNodes((current) => [...current, {
      id,
      type: "gate",
      position: { x: 80 + (current.length % 5) * 40, y: 80 + (current.length % 5) * 36 },
      data: { type, label: id, delay: type === "INPUT" ? 0 : 10, initial: 0 },
    }]);
    beginChange();
  };

  const selected = nodes.find((node) => node.selected);
  const updateSelected = (patch: Record<string, unknown>) => {
    if (!selected) return;
    beginChange();
    if (Object.hasOwn(patch, "initial")) {
      setStimulus((current) => ({
        ...current,
        initial: Object.fromEntries(Object.entries(current.initial ?? {}).filter(([nodeId]) => nodeId !== selected.id)),
      }));
    }
    setNodes((current) => current.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const run = async () => {
    if (loading || !nodes.length) return;
    const currentRun = runId.current + 1;
    runId.current = currentRun;
    const requestedRevision = revision;
    const requestedCircuit = circuit;
    const requestedStimulus = stimulus;
    const requestedMaxTime = maxTime;
    const requestedName = circuitName;
    const requestedFingerprint = await requestFingerprint(requestedCircuit, requestedStimulus, requestedMaxTime);
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const payload = await api.simulate(
        requestedCircuit,
        requestedStimulus,
        requestedMaxTime,
        requestedRevision,
        requestedName,
      );
      if (
        runId.current === currentRun
        && payload.revision === requestedRevision
        && payload.circuitFingerprint === requestedFingerprint
      ) setResult(payload);
    } catch (reason) {
      if (runId.current === currentRun) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (runId.current === currentRun) setRunning(false);
    }
  };

  const save = async () => {
    const saved = await api.save({ name: circuitName, circuit, stimulus }, savedId);
    setSavedId(saved.id);
    setCircuitName(saved.name);
    await refreshSaved();
  };

  const addStimulus = () => {
    const firstInput = inputs[0]?.id;
    if (!firstInput) return;
    beginChange();
    setStimulus((current) => ({
      ...current,
      events: [...current.events, { time: current.events.at(-1)?.time ? current.events.at(-1)!.time + 20 : 20, node: firstInput, value: 1 }],
    }));
  };

  const updateStimulus = (updater: (current: StimulusEvent[]) => StimulusEvent[]) => {
    beginChange();
    setStimulus((current) => ({ ...current, events: updater(current.events) }));
  };

  const changeMaxTime = (value: number) => {
    if (!Number.isFinite(value) || value < 1) return;
    runId.current += 1;
    setMaxTime(value);
    setResult(null);
    setRevision((current) => current + 1);
  };

  return (
    <main className="app">
      <header>
        <div>
          <h1>数字电路设计平台</h1>
          <p>逻辑元件连线 · 事件驱动仿真 · 反馈稳定性识别（板级设计预留）</p>
        </div>
        <div className="header-actions">
          <select value="" onChange={(event) => event.target.value && loadExample(event.target.value)}>
            <option value="">载入内置示例</option>
            {examples.map((example) => <option key={example.id} value={example.id}>{example.name}</option>)}
          </select>
          <button onClick={undo} disabled={!undoStack.length || loading}>撤销</button>
          <button onClick={redo} disabled={!redoStack.length || loading}>重做</button>
          <button onClick={run} disabled={running || loading || !nodes.length}>{loading ? "载入中…" : running ? "仿真中…" : "重新运行"}</button>
        </div>
      </header>

      <section className="workspace">
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

          <h2>输入事件</h2>
          <div className="events-editor">
            {stimulusEvents.map((event, index) => (
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
            <button onClick={addStimulus} disabled={!inputs.length}>添加输入变化</button>
          </div>

          <h2>保存 / 读取</h2>
          <div className="save-row">
            <input value={circuitName} onChange={(e) => setCircuitName(e.target.value)} />
            <button onClick={save}>保存</button>
          </div>
          <div className="saved-list">{savedList.map((item) => <button key={item.id} onClick={() => loadSaved(item.id)}>{item.name}</button>)}</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <label>观测窗口<input type="number" value={maxTime} min={1} onChange={(e) => changeMaxTime(Number(e.target.value))} /> ns</label>
            <button onClick={() => { beginChange(); setEdges((current) => current.filter((edge) => !edge.selected)); }}>断开选中连线</button>
            <span className="revision">
              电路版本 #{revision}
              {result ? ` · 结果来自版本 #${result.revision} · ${result.circuitFingerprint.slice(0, 10)}` : " · 结果已清空"}
            </span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeWithInvalidation}
            onConnect={onConnect}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="results">
          <h2>仿真状态</h2>
          {error && <div className="error">{error}</div>}
          {result ? <StatusCard result={result} /> : <div className="empty-panel">尚未运行。</div>}
          {result && baselineResult && <CompareSummary current={result} baseline={baselineResult} />}
          {result && (
            <div className="compare-actions">
              <button onClick={() => setBaselineResult(result)}>保存当前结果为对照</button>
              <button onClick={() => setBaselineResult(null)} disabled={!baselineResult}>清除对照</button>
            </div>
          )}
          <h2>波形</h2>
          <WaveformPanel result={result} baseline={baselineResult} />
          <h2>实际事件</h2>
          <div className="log-list">{result?.events.map((event, index) => <div key={index}><b>t={event.time}</b> {event.node} → {String(event.value)} <span>{event.reason}</span></div>)}</div>
          <h2>诊断</h2>
          <div className="diagnostics">{result?.diagnostics.map((item, index) => <div key={index} className={item.severity}>t={item.time} {item.message}</div>)}{result && !result.diagnostics.length && <div className="ok">无断连或争用</div>}</div>
        </aside>
      </section>
    </main>
  );
}

function StatusCard({ result }: { result: SimulationResult }) {
  const text = result.status === "stable" ? "已稳定" : result.status === "oscillating" ? "持续振荡" : "已截断";
  return (
    <div className={`status ${result.status}`}>
      <strong>{text}</strong>
      <span>{result.circuitName ?? "未命名电路"} · 修订 #{result.revision ?? "-"}</span>
      <span className="fingerprint">指纹 {result.circuitFingerprint.slice(0, 12)}</span>
      <span>已处理 {result.processedEvents} 个事件；未处理 {result.pendingEvents} 个</span>
      {result.reason && <span>{result.reason}</span>}
    </div>
  );
}

function CompareSummary({ current, baseline }: { current: SimulationResult; baseline: SimulationResult }) {
  const currentIds = new Set(Object.keys(current.waveforms));
  const baselineIds = new Set(Object.keys(baseline.waveforms));
  const added = [...currentIds].filter((id) => !baselineIds.has(id));
  const removed = [...baselineIds].filter((id) => !currentIds.has(id));
  const differences: string[] = [];
  for (const nodeId of currentIds) {
    if (!baselineIds.has(nodeId)) continue;
    const currentTrace = current.waveforms[nodeId];
    const baselineTrace = baseline.waveforms[nodeId];
    const firstIndex = currentTrace.findIndex((point, index) => {
      const old = baselineTrace[index];
      return !old || old.time !== point.time || old.value !== point.value;
    });
    if (firstIndex >= 0 || currentTrace.length !== baselineTrace.length) {
      const index = firstIndex >= 0 ? firstIndex : Math.min(currentTrace.length, baselineTrace.length);
      differences.push(`${nodeId}: ${baselineTrace[index]?.time ?? "无"}ns/${String(baselineTrace[index]?.value ?? "-")} → ${currentTrace[index]?.time ?? "无"}ns/${String(currentTrace[index]?.value ?? "-")}`);
    }
  }
  return (
    <div className="compare-summary">
      <strong>传播差异</strong>
      {current.status !== baseline.status && <span>状态：{baseline.status} → {current.status}</span>}
      {differences.slice(0, 8).map((item) => <span key={item}>{item}</span>)}
      {!differences.length && <span>共同节点的跳变时间和取值一致</span>}
      {added.length > 0 && <span>新增节点：{added.join(", ")}</span>}
      {removed.length > 0 && <span>移除节点：{removed.join(", ")}</span>}
    </div>
  );
}
