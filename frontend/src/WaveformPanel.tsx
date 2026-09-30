import type { LogicValue, SimulationResult } from "./types";
import { shortFingerprint } from "./fingerprint";

const rowHeight = 44;
const leftWidth = 118;
const chartHeight = 24;

function valueAt(trace: Array<{ time: number; value: LogicValue }>, time: number): LogicValue {
  let value: LogicValue = trace[0]?.value ?? "x";
  for (const point of trace) {
    if (point.time <= time) value = point.value;
  }
  return value;
}

function buildPath(trace: Array<{ time: number; value: LogicValue }>, maxTime: number, row: number) {
  const width = 1000 - leftWidth;
  const y = (value: LogicValue) => {
    if (value === 1) return row * rowHeight + 7;
    if (value === 0) return row * rowHeight + chartHeight - 7;
    return row * rowHeight + chartHeight / 2;
  };
  const events = [...trace, { time: maxTime, value: trace.at(-1)?.value ?? "x" }];
  const commands: string[] = [];
  let previous: LogicValue | null = null;
  events.forEach((point, index) => {
    const x = leftWidth + Math.max(0, Math.min(point.time, maxTime)) / maxTime * width;
    const value = point.value;
    if (index === 0) {
      commands.push(`M ${x} ${y(value)}`);
    } else if (previous !== null && previous !== value) {
      commands.push(`L ${x} ${y(previous)} L ${x} ${y(value)}`);
    }
  });
  const endX = leftWidth + width;
  commands.push(`L ${endX} ${y(valueAt(trace, maxTime))}`);
  return commands.join(" ");
}

type BaselineLike = { label: string; fingerprint: string; result: SimulationResult };

export function WaveformPanel({ result, baseline }: { result: SimulationResult | null; baseline?: BaselineLike | null }) {
  const shown = result ?? baseline?.result ?? null;
  if (!shown) return <div className="empty-panel">运行后在这里查看真实事件生成的波形。</div>;
  const rows = Array.from(new Set([
    ...Object.keys(result?.waveforms ?? {}),
    ...Object.keys(baseline?.result.waveforms ?? {}),
  ])).sort();
  const maxTime = Math.max(result?.maxTime ?? 0, baseline?.result.maxTime ?? 0);
  return (
    <div className="waveform-wrap">
      {baseline && (
        <div className="wave-legend">
          <span className="legend-current">— 当前修订 {result ? shortFingerprint(result.fingerprint) : "（未运行）"}</span>
          <span className="legend-baseline">-- 基线 {baseline.label} {shortFingerprint(baseline.fingerprint)}</span>
        </div>
      )}
      <svg viewBox={`0 0 1000 ${rows.length * rowHeight + 26}`} role="img">
        {[0, 25, 50, 75, 100].map((percent) => {
          const x = leftWidth + percent * (1000 - leftWidth) / 100;
          return (
            <g key={percent}>
              <line className="grid" x1={x} x2={x} y1={0} y2={rows.length * rowHeight} />
              <text className="axis" x={x} y={rows.length * rowHeight + 18}>{Math.round(maxTime * percent / 100)}</text>
            </g>
          );
        })}
        {rows.map((nodeId, index) => (
          <g key={nodeId}>
            <line className="row-grid" x1={leftWidth} x2="1000" y1={index * rowHeight + 22} y2={index * rowHeight + 22} />
            <text className="wave-name" x={8} y={index * rowHeight + 26}>{nodeId}</text>
            {baseline?.result.waveforms[nodeId] && (
              <path className="signal signal-baseline" d={buildPath(baseline.result.waveforms[nodeId], maxTime, index)} />
            )}
            {result?.waveforms[nodeId] ? (
              <SignalPath result={result} nodeId={nodeId} trace={result.waveforms[nodeId]} maxTime={maxTime} row={index} />
            ) : (
              <text className="axis missing" x={leftWidth + 8} y={index * rowHeight + 26}>当前修订无此节点</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function SignalPath({ result, nodeId, trace, maxTime, row }: { result: SimulationResult; nodeId: string; trace: Array<{ time: number; value: LogicValue }>; maxTime: number; row: number }) {
  const current = valueAt(trace, maxTime);
  const oscillating = result.status === "oscillating" && result.changedNodes.includes(nodeId);
  return <path className={`signal signal-current signal-${String(current)}${oscillating ? " signal-oscillating" : ""}`} d={buildPath(trace, maxTime, row)} />;
}
