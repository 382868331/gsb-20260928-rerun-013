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
import { GitCompareArrows, Redo2, Trash2, Undo2 } from "lucide-react";
import { api } from "./api";
import { circuitFingerprint, shortFingerprint } from "./fingerprint";
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

const gateTypes: GateType[] = ["INPUT", "NOT", "BUFFER", "AND", "OR", "XOR", "NAND", "NOR", "XNOR"];
const nodeCounter = { value: 0 };

type LoadedPayload = { name?: string; circuit: Circuit; stimulus?: Stimulus };
type Baseline = { label: string; fingerprint: string; result: SimulationResult };
type Snapshot = {
  nodes: Node[];
  edges: Edge[];
  events: StimulusEvent[];
  initial: Record<string, LogicValue>;
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

function initialOverrides(nodes: Node[], events: StimulusEvent[]): Stimulus {
  const initial: Record<string, LogicValue> = {};
  for (const node of nodes) {
    if (node.data.type === "INPUT") initial[node.id] = (node.data.initial as LogicValue) ?? 0;
  }
  return { initial, events };
}

export function App() {
  const [examples, setExamples] = useState<ExampleSummary[]>([]);
  const [savedList, setSavedList] = useState<SavedSummary[]>([]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([]);
  const [stimulusEvents, setStimulusEvents] = useState<StimulusEvent[]>([]);
  const [initialOverridesState, setInitialOverridesState] = useState<Record<string, LogicValue>>({});
  const [maxTime, setMaxTime] = useState(160);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [circuitName, setCircuitName] = useState("未命名电路");
  const [savedId, setSavedId] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const runTokenRef = useRef(0);
  const loadTokenRef = useRef(0);
  const autoRunRef = useRef<{ token: number; stimulus: Stimulus } | null>(null);

  const circuit = useMemo(() => toCircuit(nodes, edges), [nodes, edges]);
  const stimulus: Stimulus = useMemo(
    () => ({ initial: initialOverridesState, events: stimulusEvents }),
    [initialOverridesState, stimulusEvents],
  );
  const inputs = useMemo(() => circuit.nodes.filter((node) => node.type === "INPUT"), [circuit.nodes]);
  const fingerprint = useMemo(
    () => (nodes.length ? circuitFingerprint(circuit, stimulus, maxTime) : ""),
    [circuit, stimulus, maxTime, nodes.length],
  );

  const refreshSaved = useCallback(() => {
    api.saved().then((payload) => setSavedList(payload.circuits)).catch(() => undefined);
  }, []);

  useEffect(() => {
    api.examples().then((payload) => setExamples(payload.examples)).catch((reason) => setError(reason.message));
    refreshSaved();
  }, [refreshSaved]);

  const bumpHistory = useCallback(() => setHistoryVersion((value) => value + 1), []);

  const snapshot = useCallback((): Snapshot => ({
    nodes,
    edges,
    events: stimulusEvents,
    initial: { ...initialOverridesState },
  }), [nodes, edges, stimulusEvents, initialOverridesState]);

  const commitHistory = useCallback(() => {
    historyRef.current.push(snapshot());
    if (historyRef.current.length > 100) historyRef.current.shift();
    futureRef.current = [];
    bumpHistory();
  }, [snapshot, bumpHistory]);

  const invalidate = useCallback(() => {
    setRevision((value) => value + 1);
    setResult(null);
  }, []);

  const restoreSnapshot = useCallback((next: Snapshot) => {
    setNodes(next.nodes);
    setEdges(next.edges);
    setStimulusEvents(next.events);
    setInitialOverridesState(next.initial);
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

  const runCircuit = useCallback(async (explicit?: { circuit: Circuit; stimulus: Stimulus; maxTime: number }) => {
    const requestCircuit = explicit?.circuit ?? circuit;
    if (!requestCircuit.nodes.length) return;
    const requestStimulus = explicit?.stimulus ?? stimulus;
    const requestMaxTime = explicit?.maxTime ?? maxTime;
    const expectedFingerprint = circuitFingerprint(requestCircuit, requestStimulus, requestMaxTime);
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const payload = await api.simulate(requestCircuit, requestStimulus, requestMaxTime);
      if (runTokenRef.current !== token) return;
      if (payload.fingerprint !== expectedFingerprint) {
        setError("仿真结果与当前电路版本不一致，已丢弃。");
        return;
      }
      setResult(payload);
    } catch (reason) {
      if (runTokenRef.current === token) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (runTokenRef.current === token) setRunning(false);
    }
  }, [circuit, stimulus, maxTime]);

  const applyPayload = useCallback((payload: LoadedPayload, id: string | undefined, autoRun: boolean, expectedToken?: number) => {
    if (expectedToken !== undefined && expectedToken !== loadTokenRef.current) return;
    if (!payload.circuit?.nodes?.length) {
      setError("载入的电路为空，已取消运行。");
      return;
    }
    const loadToken = expectedToken ?? loadTokenRef.current + 1;
    loadTokenRef.current = loadToken;
    runTokenRef.current += 1;
    const flow = toFlow(payload.circuit);
    const loadedStimulus: Stimulus = { initial: {}, events: payload.stimulus?.events ?? [], ...payload.stimulus };
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setStimulusEvents(loadedStimulus.events ?? []);
    setInitialOverridesState(loadedStimulus.initial ?? {});
    setCircuitName(payload.name ?? "未命名电路");
    setSavedId(id);
    setResult(null);
    setBaseline(null);
    setError("");
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
      autoRunRef.current = { token: loadToken, stimulus: loadedStimulus };
    }
  }, [bumpHistory, setEdges, setNodes]);

  const applyLoadFailure = (token: number, reason: unknown) => {
    if (loadTokenRef.current === token) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRunning(false);
    }
  };

  const loadExample = useCallback(async (id: string) => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    setResult(null);
    setRunning(true);
    try {
      applyPayload(await api.example(id), undefined, true, token);
    } catch (reason) {
      applyLoadFailure(token, reason);
    }
  }, [applyPayload]);

  const loadSaved = useCallback(async (id: string) => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    setResult(null);
    setRunning(true);
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
        setError(reason instanceof Error ? reason.message : String(reason));
        setRunning(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const pending = autoRunRef.current;
    if (!pending || pending.token !== loadTokenRef.current || !nodes.length) return;
    autoRunRef.current = null;
    void runCircuit({ circuit: toCircuit(nodes, edges), stimulus: pending.stimulus, maxTime });
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
    const saved = await api.save({ name: circuitName, circuit, stimulus: { initial: initialOverridesState, events: stimulusEvents } }, savedId);
    setSavedId(saved.id);
    setCircuitName(saved.name);
    refreshSaved();
  };

  const addStimulus = () => {
    const firstInput = inputs[0]?.id;
    if (!firstInput) return;
    commitHistory();
    invalidate();
    setStimulusEvents((current) => [...current, { time: current.at(-1)?.time ? current.at(-1)!.time + 20 : 20, node: firstInput, value: 1 }]);
  };

  const updateStimulus = (updater: (current: StimulusEvent[]) => StimulusEvent[]) => {
    commitHistory();
    invalidate();
    setStimulusEvents(updater);
  };

  const updateInitial = (nodeId: string, value: LogicValue) => {
    commitHistory();
    invalidate();
    setInitialOverridesState((current) => ({ ...current, [nodeId]: value }));
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, initial: value } } : node));
  };

  const disconnectSelected = () => {
    if (!edges.some((edge) => edge.selected)) return;
    commitHistory();
    invalidate();
    setEdges((current) => current.filter((edge) => !edge.selected));
  };

  const keepBaseline = useCallback(() => {
    if (result) setBaseline({ label: `修订 #${revision}`, fingerprint: result.fingerprint, result });
  }, [result, revision]);

  const resultMatchesCurrent = result?.fingerprint === fingerprint;
  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

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
          <button onClick={() => runCircuit()} disabled={running || !nodes.length}>{running ? "仿真中…" : "运行当前版本"}</button>
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

          <h2>输入初值</h2>
          <div className="initial-grid">
            {inputs.length ? inputs.map((input) => (
              <label key={input.id}>{input.id}
                <select value={String(initialOverridesState[input.id] ?? input.initial ?? 0)} onChange={(e) => updateInitial(input.id, e.target.value === "x" ? "x" : Number(e.target.value) as LogicValue)}>
                  <option value="0">0</option><option value="1">1</option><option value="x">X</option>
                </select>
              </label>
            )) : <p className="hint">添加 INPUT 元件。</p>}
          </div>

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
            <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)"><Undo2 size={15} /></button>
            <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
            <label>观测窗口<input type="number" value={maxTime} min={1} onChange={(e) => { invalidate(); setMaxTime(Number(e.target.value)); }} /> ns</label>
            <button onClick={disconnectSelected}>断开选中连线</button>
            <span className="revision">
              修订 #{revision} · 指纹 {fingerprint ? shortFingerprint(fingerprint) : "—"} · 
              {running ? "计算中" : result ? (resultMatchesCurrent ? "结果属于当前电路" : "结果版本不符，已隔离") : "尚未运行"}
            </span>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
          {!ready && <div className="empty-panel">正在载入首个示例，空画布不会被提交。</div>}
          {result ? <StatusCard result={result} current={resultMatchesCurrent} /> : ready ? <div className="empty-panel">尚未运行。</div> : null}
          <h2>修订波形对照</h2>
          <div className="compare-controls">
            <button onClick={keepBaseline} disabled={!result || !resultMatchesCurrent}><GitCompareArrows size={14} /> 保存当前结果为对照基线</button>
            <button onClick={() => setBaseline(null)} disabled={!baseline}>清除基线</button>
          </div>
          {baseline && <div className="baseline-meta">基线：{baseline.label}（{shortFingerprint(baseline.fingerprint)}）</div>}
          <WaveformPanel result={resultMatchesCurrent ? result : null} baseline={baseline} />
          <RevisionDiff current={resultMatchesCurrent ? result : null} baseline={baseline} />
          <h2>实际事件</h2>
          <div className="log-list">{result?.events.map((event, index) => <div key={index}><b>t={event.time}</b> {event.node} → {String(event.value)} <span>{event.reason}</span></div>)}</div>
          <h2>诊断</h2>
          <div className="diagnostics">{result?.diagnostics.map((item, index) => <div key={index} className={item.severity}>t={item.time} {item.message}</div>)}{result && !result.diagnostics.length && <div className="ok">无断连或争用</div>}</div>
        </aside>
      </section>
    </main>
  );
}

function StatusCard({ result, current }: { result: SimulationResult; current: boolean }) {
  const text = result.status === "stable" ? "已稳定" : result.status === "oscillating" ? "持续振荡" : "已截断";
  return (
    <div className={`status ${result.status}`}>
      <strong>{text}</strong>
      <span>电路指纹 {shortFingerprint(result.fingerprint)}{current ? " · 与当前画布一致" : " · 与当前画布不一致"}</span>
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

function RevisionDiff({ current, baseline }: { current: SimulationResult | null; baseline: Baseline | null }) {
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
