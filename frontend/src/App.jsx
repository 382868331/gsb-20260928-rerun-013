import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import GateNode from './GateNode.jsx';
import Waveform from './Waveform.jsx';

const nodeTypes = { gate: GateNode };
const GATE_TYPES = ['AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'NOT', 'BUF', 'INPUT', 'OUTPUT'];
const DEFAULT_DELAY = { AND: 5, OR: 5, XOR: 6, NAND: 4, NOR: 4, XNOR: 6, NOT: 3, BUF: 2, INPUT: 0, OUTPUT: 0 };

let idCounter = 1;
const nextId = (p) => `${p}${idCounter++}`;

function toCircuit(nodes, edges) {
  return {
    gates: nodes.map((n) => ({
      id: n.id,
      type: n.data.gtype,
      label: n.data.label,
      delay: Number(n.data.delay) || 0,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      ...(n.data.gtype === 'INPUT'
        ? { stimulus: n.data.stimulus, value: n.data.value ?? '0' }
        : {}),
    })),
    wires: edges.map((e) => ({
      id: e.id,
      from: { gate: e.source },
      to: { gate: e.target, pin: Number((e.targetHandle || 'in-0').split('-')[1]) || 0 },
      delay: Number(e.data?.delay) || 0,
    })),
  };
}

function fromCircuit(circuit) {
  const nodes = (circuit.gates || []).map((g) => ({
    id: g.id,
    type: 'gate',
    position: { x: g.x ?? 100, y: g.y ?? 100 },
    data: {
      gtype: g.type,
      label: g.label || g.id,
      delay: g.delay ?? 0,
      stimulus: g.stimulus || [[0, g.value ?? '0']],
      value: g.value ?? '0',
    },
  }));
  const edges = (circuit.wires || []).map((w) => ({
    id: w.id,
    source: w.from.gate,
    sourceHandle: 'out',
    target: w.to.gate,
    targetHandle: `in-${w.to.pin ?? 0}`,
    data: { delay: w.delay ?? 0 },
    label: w.delay ? `Δ${w.delay}` : '',
  }));
  for (const g of circuit.gates || []) {
    const n = parseInt(String(g.id).replace(/\D+/g, ''), 10);
    if (!Number.isNaN(n)) idCounter = Math.max(idCounter, n + 1);
  }
  return { nodes, edges };
}

function parseStimulus(text) {
  const pts = [];
  for (const part of text.split(/[,;\s]+/)) {
    if (!part) continue;
    const [t, v] = part.split(/[:=]/);
    const tt = Number(t);
    if (Number.isNaN(tt) || !['0', '1', 'X'].includes(v)) {
      throw new Error(`无法解析激励 "${part}"，格式如 0:0 20:1`);
    }
    pts.push([tt, v]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts;
}

export default function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selection, setSelection] = useState({ nodes: [], edges: [] });
  const [duration, setDuration] = useState(200);
  const [result, setResult] = useState(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [examples, setExamples] = useState([]);
  const [saved, setSaved] = useState([]);
  const [circuitName, setCircuitName] = useState('我的电路');
  const runSeq = useRef(0);

  const markStale = useCallback(() => setStale(true), []);

  const onNodesChange = useCallback((changes) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) markStale();
  }, [markStale]);
  const onEdgesChange = useCallback((changes) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== 'select')) markStale();
  }, [markStale]);
  const onConnect = useCallback((conn) => {
    setEdges((es) => addEdge({ ...conn, data: { delay: 0 } }, es));
    markStale();
  }, [markStale]);

  useEffect(() => {
    fetch('/api/examples').then((r) => r.json()).then(setExamples).catch(() => {});
    refreshSaved();
  }, []);
  const refreshSaved = () =>
    fetch('/api/circuits').then((r) => r.json()).then(setSaved).catch(() => {});

  const loadCircuit = (circuit, name) => {
    const { nodes: ns, edges: es } = fromCircuit(circuit);
    setNodes(ns);
    setEdges(es);
    setResult(null);
    setStale(false);
    setError(null);
    if (name) setCircuitName(name);
  };

  const addGate = (gtype) => {
    const id = nextId(gtype.toLowerCase().slice(0, 3));
    setNodes((ns) => ns.concat({
      id,
      type: 'gate',
      position: { x: 120 + Math.random() * 200, y: 80 + Math.random() * 200 },
      data: {
        gtype,
        label: id,
        delay: DEFAULT_DELAY[gtype] ?? 0,
        stimulus: [[0, '0']],
        value: '0',
      },
    }));
    markStale();
  };

  const runSim = async () => {
    const seq = ++runSeq.current;
    setRunning(true);
    setError(null);
    try {
      const resp = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ circuit: toCircuit(nodes, edges), duration }),
      });
      const data = await resp.json();
      if (seq !== runSeq.current) return; // 已有更新的运行
      if (!resp.ok) throw new Error(data.detail || '仿真失败');
      setResult(data);
      setStale(false);
    } catch (e) {
      if (seq === runSeq.current) setError(e.message);
    } finally {
      if (seq === runSeq.current) setRunning(false);
    }
  };

  const saveCircuit = async () => {
    const circuit = { ...toCircuit(nodes, edges), name: circuitName };
    const resp = await fetch(`/api/circuits/${encodeURIComponent(circuitName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(circuit),
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      setError(d.detail || '保存失败');
      return;
    }
    refreshSaved();
  };

  const selNode = nodes.find((n) => selection.nodes.includes(n.id));
  const selEdge = edges.find((e) => selection.edges.includes(e.id));

  const updateNodeData = (id, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    markStale();
  };
  const updateEdgeData = (id, patch) => {
    setEdges((es) => es.map((e) => (e.id === id
      ? { ...e, data: { ...e.data, ...patch }, label: patch.delay ? `Δ${patch.delay}` : '' }
      : e)));
    markStale();
  };

  const labels = Object.fromEntries(nodes.map((n) => [n.id, `${n.data.label} (${n.data.gtype})`]));

  return (
    <div className="app">
      <header className="toolbar">
        <span className="title">数字电路设计平台</span>
        {GATE_TYPES.map((t) => (
          <button key={t} className="pal" onClick={() => addGate(t)}>+ {t}</button>
        ))}
        <span className="spacer" />
        <label>时长 <input type="number" value={duration} min={10}
          onChange={(e) => setDuration(Number(e.target.value) || 200)} /> ns</label>
        <button className="run" onClick={runSim} disabled={running}>
          {running ? '仿真中…' : '▶ 运行仿真'}
        </button>
        {result && !stale && (
          <span className={`badge ${result.status}`}>
            {result.status === 'stable' ? '✓ 稳定' : '⚠ 持续振荡'} · {result.events} 事件
          </span>
        )}
        {result && stale && <span className="badge stale">结果已过期（电路已修改）</span>}
      </header>

      <div className="toolbar sub">
        <select defaultValue="" onChange={(e) => {
          const ex = examples.find((x) => x.name === e.target.value);
          if (ex) loadCircuit(ex.circuit, ex.name);
        }}>
          <option value="" disabled>加载示例…</option>
          {examples.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
        <select defaultValue="" onChange={async (e) => {
          if (!e.target.value) return;
          const r = await fetch(`/api/circuits/${encodeURIComponent(e.target.value)}`);
          if (r.ok) loadCircuit(await r.json(), e.target.value);
        }}>
          <option value="" disabled>打开已保存…</option>
          {saved.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={circuitName} onChange={(e) => setCircuitName(e.target.value)} />
        <button onClick={saveCircuit}>保存电路</button>
        <button onClick={async () => {
          await fetch(`/api/circuits/${encodeURIComponent(circuitName)}`, { method: 'DELETE' });
          refreshSaved();
        }}>删除</button>
        {error && <span className="error">{error}</span>}
      </div>

      <div className="main">
        <div className="canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={(sel) => setSelection({ nodes: sel.nodes.map((n) => n.id), edges: sel.edges.map((e) => e.id) })}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <aside className="sidebar">
          {!selNode && !selEdge && (
            <div className="hint">
              <p>从工具栏添加元件，拖动连线（右侧输出 → 左侧输入）。</p>
              <p>同一输入引脚可连多条线，用于演示总线争用（E）。未连接的输入为未知（X）。</p>
              <p>选中元件或连线后在此编辑属性。</p>
            </div>
          )}
          {selNode && (
            <div className="props">
              <h3>{selNode.data.gtype} · {selNode.id}</h3>
              <label>名称
                <input value={selNode.data.label}
                  onChange={(e) => updateNodeData(selNode.id, { label: e.target.value })} />
              </label>
              {selNode.data.gtype !== 'INPUT' && selNode.data.gtype !== 'OUTPUT' && (
                <label>传播延迟 (ns)
                  <input type="number" min={0} value={selNode.data.delay}
                    onChange={(e) => updateNodeData(selNode.id, { delay: Number(e.target.value) || 0 })} />
                </label>
              )}
              {selNode.data.gtype === 'INPUT' && (
                <>
                  <label>激励（时间:值，空格分隔）
                    <textarea rows={4} defaultValue={selNode.data.stimulus.map((p) => p.join(':')).join(' ')}
                      onBlur={(e) => {
                        try {
                          updateNodeData(selNode.id, { stimulus: parseStimulus(e.target.value) });
                          setError(null);
                        } catch (err) { setError(err.message); }
                      }} />
                  </label>
                  <div className="row">
                    <button onClick={() => {
                      const s = selNode.data.stimulus;
                      const last = s[s.length - 1];
                      updateNodeData(selNode.id, {
                        stimulus: [...s, [last[0] + 20, last[1] === '1' ? '0' : '1']],
                      });
                    }}>+20ns 翻转</button>
                    <button onClick={() => updateNodeData(selNode.id, { stimulus: [[0, '0']] })}>清空</button>
                  </div>
                </>
              )}
            </div>
          )}
          {selEdge && (
            <div className="props">
              <h3>连线 {selEdge.source} → {selEdge.target}</h3>
              <label>传输延迟 (ns)
                <input type="number" min={0} value={selEdge.data?.delay ?? 0}
                  onChange={(e) => updateEdgeData(selEdge.id, { delay: Number(e.target.value) || 0 })} />
              </label>
              <p className="hint">不同延迟的连线按各自时刻送达，不会合并为一次静态计算。</p>
            </div>
          )}
        </aside>
      </div>

      <div className="wave-panel">
        <Waveform traces={result?.traces} duration={result?.duration ?? duration} labels={labels} />
        <div className="legend">
          <span><i className="sw hi" />1</span>
          <span><i className="sw lo" />0</span>
          <span><i className="sw x" />X 未知</span>
          <span><i className="sw e" />E 争用</span>
        </div>
      </div>
    </div>
  );
}
