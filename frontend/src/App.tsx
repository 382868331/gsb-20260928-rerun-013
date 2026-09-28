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
  StimulusEvent,
} from "./types";

const gateTypes: GateType[] = ["INPUT", "NOT", "BUFFER", "AND", "OR", "XOR", "NAND", "NOR", "XNOR"];
const nodeCounter = { value: 0 };

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
  const [stimulusEvents, setStimulusEvents] = useState<StimulusEvent[]>([]);
  const [maxTime, setMaxTime] = useState(160);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [circuitName, setCircuitName] = useState("未命名电路");
  const [savedId, setSavedId] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const runId = useRef(0);
  const circuit = useMemo(() => toCircuit(nodes, edges), [nodes, edges]);
  const inputs = useMemo(() => circuit.nodes.filter((node) => node.type === "INPUT"), [circuit.nodes]);

  useEffect(() => {
    api.examples().then((payload) => setExamples(payload.examples)).catch((reason) => setError(reason.message));
    refreshSaved();
  }, []);

  const refreshSaved = () => api.saved().then((payload) => setSavedList(payload.circuits)).catch(() => undefined);

  const invalidate = useCallback(() => {
    setRevision((value) => value + 1);
    setResult(null);
    setSavedId(undefined);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    if (changes.some((change) => change.type === "remove" || change.type === "add")) invalidate();
    onNodesChangeBase(changes);
  }, [invalidate, onNodesChangeBase]);

  const onConnect = useCallback((connection: Connection) => {
    invalidate();
    setEdges((current) => addEdge({ ...connection, sourceHandle: "out", label: connection.targetHandle }, current));
  }, [invalidate, setEdges]);

  const onEdgesChangeWithInvalidation = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    if (changes.some((change) => change.type === "remove" || change.type === "add")) invalidate();
    onEdgesChange(changes);
  }, [invalidate, onEdgesChange]);

  const loadPayload = (payload: { name?: string; circuit: Circuit; stimulus?: { events?: StimulusEvent[] } }, id?: string) => {
    const flow = toFlow(payload.circuit);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setStimulusEvents(payload.stimulus?.events ?? []);
    setCircuitName(payload.name ?? "未命名电路");
    setSavedId(id);
    setResult(null);
    setError("");
    setRevision((value) => value + 1);
  };

  const loadExample = async (id: string) => {
    const example = await api.example(id);
    loadPayload(example);
  };

  const loadSaved = async (id: string) => {
    const saved = await api.load(id);
    loadPayload(saved, id);
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
    invalidate();
  };

  const selected = nodes.find((node) => node.selected);
  const updateSelected = (patch: Record<string, unknown>) => {
    if (!selected) return;
    invalidate();
    setNodes((current) => current.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node));
  };

  const run = async () => {
    const currentRun = runId.current + 1;
    runId.current = currentRun;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const payload = await api.simulate(circuit, { events: stimulusEvents }, maxTime);
      if (runId.current === currentRun) setResult(payload);
    } catch (reason) {
      if (runId.current === currentRun) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (runId.current === currentRun) setRunning(false);
    }
  };

  const save = async () => {
    const saved = await api.save({ name: circuitName, circuit, stimulus: { events: stimulusEvents } }, savedId);
    setSavedId(saved.id);
    setCircuitName(saved.name);
    await refreshSaved();
  };

  const addStimulus = () => {
    const firstInput = inputs[0]?.id;
    if (!firstInput) return;
    setStimulusEvents((current) => [...current, { time: current.at(-1)?.time ? current.at(-1)!.time + 20 : 20, node: firstInput, value: 1 }]);
    invalidate();
  };

  const updateStimulus = (updater: (current: StimulusEvent[]) => StimulusEvent[]) => {
    setStimulusEvents(updater);
    invalidate();
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
          <button onClick={run} disabled={running}>{running ? "仿真中…" : "重新运行"}</button>
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
            <label>观测窗口<input type="number" value={maxTime} min={1} onChange={(e) => setMaxTime(Number(e.target.value))} /> ns</label>
            <button onClick={() => { setEdges((current) => current.filter((edge) => !edge.selected)); invalidate(); }}>断开选中连线</button>
            <span className="revision">电路版本 #{revision} · 当前结果{result ? `来自第 ${revision} 次运行` : "已清空"}</span>
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
          <h2>波形</h2>
          <WaveformPanel result={result} />
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
      <span>已处理 {result.processedEvents} 个事件；未处理 {result.pendingEvents} 个</span>
      {result.reason && <span>{result.reason}</span>}
    </div>
  );
}
