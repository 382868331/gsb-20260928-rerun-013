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

const svgWidth = 1000;

export function WaveformPanel({
  result,
  baseline,
  cursorTime,
  diffTime,
  onCursorTimeChange,
}: {
  result: SimulationResult | null;
  baseline?: BaselineLike | null;
  cursorTime?: number | null;
  diffTime?: number | null;
  onCursorTimeChange?: (time: number) => void;
}) {
  const shown = result ?? baseline?.result ?? null;
  const rows = shown ? Array.from(new Set([
    ...Object.keys(result?.waveforms ?? {}),
    ...Object.keys(baseline?.result.waveforms ?? {}),
  ])).sort() : [];
  const maxTime = shown ? Math.max(result?.maxTime ?? 0, baseline?.result.maxTime ?? 0) : 0;
  const chartWidth = svgWidth - leftWidth;
  const timeToX = (time: number) => leftWidth + Math.max(0, Math.min(time, maxTime)) / maxTime * chartWidth;
  const xToTime = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const xInViewBox = (clientX - rect.left) / rect.width * svgWidth;
    const chartX = Math.max(0, Math.min(xInViewBox - leftWidth, chartWidth));
    return Math.max(0, Math.min(maxTime, chartX / chartWidth * maxTime));
  };
  const cursorX = cursorTime !== null && cursorTime !== undefined && maxTime > 0 ? timeToX(cursorTime) : null;
  const diffX = diffTime !== null && diffTime !== undefined && maxTime > 0 ? timeToX(diffTime) : null;
  const svgHeight = rows.length * rowHeight + 26;
  const moveCursor = (deltaRatio: number) => {
    if (!onCursorTimeChange || maxTime <= 0) return;
    const base = cursorTime ?? 0;
    onCursorTimeChange(Math.max(0, Math.min(maxTime, base + deltaRatio * maxTime)));
  };
  return (
    <div className="waveform-wrap">
      {baseline && shown && (
        <div className="wave-legend">
          <span className="legend-current">— 当前修订 {result ? shortFingerprint(result.fingerprint) : "（未运行）"}</span>
          <span className="legend-baseline">-- 基线 {baseline.label} {shortFingerprint(baseline.fingerprint)}</span>
        </div>
      )}
      {!shown ? (
        <div className="empty-panel">运行后在这里查看真实事件生成的波形。</div>
      ) : (
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label={`波形图，观测窗口 0 到 ${maxTime} 纳秒，共 ${rows.length} 个节点。点击波形区域选择时刻，左右方向键步进。`}
          tabIndex={onCursorTimeChange ? 0 : -1}
          className="waveform-svg"
          onClick={(event) => {
            if (!onCursorTimeChange) return;
            onCursorTimeChange(Math.round(xToTime(event.clientX, event.currentTarget)));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); moveCursor(-0.02); }
            if (event.key === "ArrowRight") { event.preventDefault(); moveCursor(0.02); }
            if (event.key === "Home") { event.preventDefault(); onCursorTimeChange?.(0); }
            if (event.key === "End") { event.preventDefault(); onCursorTimeChange?.(maxTime); }
          }}
        >
          {[0, 25, 50, 75, 100].map((percent) => {
            const x = leftWidth + percent * chartWidth / 100;
            return (
              <g key={percent}>
                <line className="grid" x1={x} x2={x} y1={0} y2={rows.length * rowHeight} />
                <text className="axis" x={x} y={rows.length * rowHeight + 18}>{Math.round(maxTime * percent / 100)}</text>
              </g>
            );
          })}
          {rows.map((nodeId, index) => (
            <g key={nodeId}>
              <line className="row-grid" x1={leftWidth} x2={svgWidth} y1={index * rowHeight + 22} y2={index * rowHeight + 22} />
              <text className="wave-name" x={8} y={index * rowHeight + 26}>{nodeId}</text>
              {baseline?.result.waveforms[nodeId] && (
                <path className="signal signal-baseline" d={buildPath(baseline.result.waveforms[nodeId], maxTime, index)} pointerEvents="none" />
              )}
              {result?.waveforms[nodeId] ? (
                <SignalPath result={result} nodeId={nodeId} trace={result.waveforms[nodeId]} maxTime={maxTime} row={index} />
              ) : (
                <text className="axis missing" x={leftWidth + 8} y={index * rowHeight + 26}>当前修订无此节点</text>
              )}
            </g>
          ))}
          {diffX !== null && (
            <g className="diff-marker" pointerEvents="none">
              <line x1={diffX} x2={diffX} y1={0} y2={rows.length * rowHeight} />
              <text className="diff-label" x={Math.min(diffX + 4, svgWidth - 88)} y={12}>差异 t={diffTime}</text>
            </g>
          )}
          {cursorX !== null && (
            <g className="time-cursor" pointerEvents="none">
              <line x1={cursorX} x2={cursorX} y1={0} y2={rows.length * rowHeight} />
              <circle cx={cursorX} cy={6} r={3.5} />
              <text className="cursor-label" x={Math.min(cursorX + 5, svgWidth - 70)} y={rows.length * rowHeight - 4}>t={Math.round(cursorTime ?? 0)}</text>
            </g>
          )}
        </svg>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {cursorTime !== null && cursorTime !== undefined ? `已选择波形时刻 t=${Math.round(cursorTime)} 纳秒` : ""}
        {diffTime !== null && diffTime !== undefined ? `，首个差异位于 t=${diffTime} 纳秒` : ""}
      </div>
    </div>
  );
}

function SignalPath({ result, nodeId, trace, maxTime, row }: { result: SimulationResult; nodeId: string; trace: Array<{ time: number; value: LogicValue }>; maxTime: number; row: number }) {
  const current = valueAt(trace, maxTime);
  const oscillating = result.status === "oscillating" && result.changedNodes.includes(nodeId);
  return <path className={`signal signal-current signal-${String(current)}${oscillating ? " signal-oscillating" : ""}`} d={buildPath(trace, maxTime, row)} />;
}
