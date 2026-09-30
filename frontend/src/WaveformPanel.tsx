import type { LogicValue, SimulationResult } from "./types";

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

function SignalPath({ trace, maxTime, row, variant = "current", label }: {
  trace: Array<{ time: number; value: LogicValue }>;
  maxTime: number;
  row: number;
  variant?: "current" | "baseline";
  label: string;
}) {
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
  const current = valueAt(trace, maxTime);
  commands.push(`L ${endX} ${y(current)}`);
  return <path className={`signal signal-${String(current)} signal-${variant}`} d={commands.join(" ")}><title>{label}</title></path>;
}

export function WaveformPanel({ result, baseline }: { result: SimulationResult | null; baseline: SimulationResult | null }) {
  if (!result) return <div className="empty-panel">运行后在这里查看真实事件生成的波形。</div>;
  const effectiveMaxTime = baseline ? Math.max(result.maxTime, baseline.maxTime) : result.maxTime;
  const nodeIds = Array.from(new Set([
    ...Object.keys(result.waveforms),
    ...(baseline ? Object.keys(baseline.waveforms) : []),
  ])).sort();
  return (
    <div className="waveform-wrap">
      {baseline && (
        <div className="wave-legend">
          <span className="legend-current">当前 #{result.revision ?? "-"} {result.circuitName ?? ""} {result.circuitFingerprint.slice(0, 8)}</span>
          <span className="legend-baseline">对照 #{baseline.revision ?? "-"} {baseline.circuitName ?? ""} {baseline.circuitFingerprint.slice(0, 8)}</span>
        </div>
      )}
      <svg viewBox={`0 0 1000 ${nodeIds.length * rowHeight + 26}`} role="img">
        {[0, 25, 50, 75, 100].map((percent) => {
          const x = leftWidth + percent * (1000 - leftWidth) / 100;
          return (
            <g key={percent}>
              <line className="grid" x1={x} x2={x} y1={0} y2={nodeIds.length * rowHeight} />
              <text className="axis" x={x} y={nodeIds.length * rowHeight + 18}>{Math.round(effectiveMaxTime * percent / 100)}</text>
            </g>
          );
        })}
        {nodeIds.map((nodeId, index) => (
          <g key={nodeId}>
            <line className="row-grid" x1="0" x2="1000" y1={index * rowHeight + 22} y2={index * rowHeight + 22} />
            <text className="wave-name" x={8} y={index * rowHeight + 26}>{nodeId}</text>
            {baseline?.waveforms[nodeId] && <SignalPath trace={baseline.waveforms[nodeId]} maxTime={effectiveMaxTime} row={index} variant="baseline" label={`对照 ${nodeId}`} />}
            {result.waveforms[nodeId] && <SignalPath trace={result.waveforms[nodeId]} maxTime={effectiveMaxTime} row={index} label={`当前 ${nodeId}`} />}
          </g>
        ))}
      </svg>
    </div>
  );
}
