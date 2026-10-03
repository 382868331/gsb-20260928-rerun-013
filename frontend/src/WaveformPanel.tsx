import { useEffect, useRef, useState } from "react";
import type { CursorSelection, LogicValue, SimulationResult } from "./types";
import { shortFingerprint } from "./fingerprint";

const rowHeight = 44;
const leftWidth = 118;
const chartHeight = 24;
const viewWidth = 1000;

function valueAt(trace: Array<{ time: number; value: LogicValue }>, time: number): LogicValue {
  let value: LogicValue = trace[0]?.value ?? "x";
  for (const point of trace) {
    if (point.time <= time) value = point.value;
  }
  return value;
}

function buildPath(trace: Array<{ time: number; value: LogicValue }>, maxTime: number, row: number) {
  const width = viewWidth - leftWidth;
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

function timeToX(time: number, maxTime: number) {
  return leftWidth + Math.max(0, Math.min(time, maxTime)) / maxTime * (viewWidth - leftWidth);
}

type BaselineLike = { label: string; fingerprint: string; result: SimulationResult };
export type LocateRequest = { time: number; nodeId: string; seq: number };

export function WaveformPanel({
  result,
  baseline,
  cursor,
  windowMaxTime,
  onCursorChange,
  locateRequest,
}: {
  result: SimulationResult | null;
  baseline?: BaselineLike | null;
  cursor?: CursorSelection | null;
  windowMaxTime?: number;
  onCursorChange?: (time: number) => void;
  locateRequest?: LocateRequest | null;
}) {
  const shown = result ?? baseline?.result ?? null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [highlightNode, setHighlightNode] = useState<string | null>(null);
  const maxTime = Math.max(result?.maxTime ?? 0, baseline?.result.maxTime ?? 0);

  useEffect(() => {
    if (!locateRequest || !shown || maxTime <= 0) return;
    setHighlightNode(locateRequest.nodeId);
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (wrap && svg) {
      const fraction = timeToX(locateRequest.time, maxTime) / viewWidth;
      wrap.scrollLeft = fraction * svg.getBoundingClientRect().width - wrap.clientWidth / 2;
    }
  }, [locateRequest, shown, maxTime]);

  if (!shown) return <div className="empty-panel">运行后在这里查看真实事件生成的波形。</div>;

  const rows = Array.from(new Set([
    ...Object.keys(result?.waveforms ?? {}),
    ...Object.keys(baseline?.result.waveforms ?? {}),
  ])).sort();
  const cursorVisible = cursor != null && cursor.fingerprint === shown.fingerprint;
  const cursorOutOfWindow = cursor != null && windowMaxTime !== undefined && cursor.time > windowMaxTime;
  const cursorX = cursor && maxTime > 0 ? timeToX(cursor.time, maxTime) : 0;

  const handleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onCursorChange || maxTime <= 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewX = (event.clientX - rect.left) / rect.width * viewWidth;
    const ratio = (viewX - leftWidth) / (viewWidth - leftWidth);
    onCursorChange(Math.round(Math.max(0, Math.min(1, ratio)) * maxTime));
  };

  return (
    <div className="waveform-panel">
      <div className="wave-toolbar">
        <span className="hint-inline">点击波形设置选择时刻</span>
        <button onClick={() => setZoom((value) => Math.min(8, value * 2))} disabled={zoom >= 8}>放大</button>
        <button onClick={() => setZoom((value) => Math.max(1, value / 2))} disabled={zoom <= 1}>缩小</button>
        {zoom > 1 && <button onClick={() => setZoom(1)}>重置缩放</button>}
      </div>
      {cursor && !cursorVisible && (
        <div className="cursor-note">
          选择时刻 t={cursor.time} 属于结果组合 {shortFingerprint(cursor.fingerprint)}，与当前显示（{shortFingerprint(shown.fingerprint)}）不同；切回对应方案/窗口后恢复显示。
        </div>
      )}
      {cursorVisible && cursorOutOfWindow && (
        <div className="cursor-note">
          选择时刻 t={cursor.time} 超出当前观测窗口（{windowMaxTime} ns），光标已贴到窗口边缘；扩大窗口后自动回到原时刻，不会归零。
        </div>
      )}
      {cursorVisible && !cursorOutOfWindow && (
        <div className="cursor-note cursor-note-ok">选择时刻 t={cursor.time}（{shortFingerprint(shown.fingerprint)}）</div>
      )}
      {baseline && (
        <div className="wave-legend">
          <span className="legend-current">— 当前修订 {result ? shortFingerprint(result.fingerprint) : "（未运行）"}</span>
          <span className="legend-baseline">-- 基线 {baseline.label} {shortFingerprint(baseline.fingerprint)}</span>
        </div>
      )}
      <div className="waveform-wrap" ref={wrapRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewWidth} ${rows.length * rowHeight + 26}`}
          role="img"
          style={{ width: `${zoom * 100}%` }}
          onClick={handleClick}
        >
          {[0, 25, 50, 75, 100].map((percent) => {
            const x = leftWidth + percent * (viewWidth - leftWidth) / 100;
            return (
              <g key={percent}>
                <line className="grid" x1={x} x2={x} y1={0} y2={rows.length * rowHeight} />
                <text className="axis" x={x} y={rows.length * rowHeight + 18}>{Math.round(maxTime * percent / 100)}</text>
              </g>
            );
          })}
          {rows.map((nodeId, index) => (
            <g key={nodeId}>
              {highlightNode === nodeId && (
                <rect className="wave-row-active" x={0} y={index * rowHeight} width={viewWidth} height={rowHeight} />
              )}
              <line className="row-grid" x1={leftWidth} x2={viewWidth} y1={index * rowHeight + 22} y2={index * rowHeight + 22} />
              <text className={highlightNode === nodeId ? "wave-name wave-name-active" : "wave-name"} x={8} y={index * rowHeight + 26}>{nodeId}</text>
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
          {cursorVisible && (
            <g className={cursorOutOfWindow ? "cursor cursor-clamped" : "cursor"}>
              <line className="cursor-line" x1={cursorX} x2={cursorX} y1={0} y2={rows.length * rowHeight} />
              <text className="cursor-label" x={Math.min(cursorX + 4, viewWidth - 60)} y={12}>
                t={cursorOutOfWindow ? `${cursor.time}→${maxTime}` : cursor.time}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

function SignalPath({ result, nodeId, trace, maxTime, row }: { result: SimulationResult; nodeId: string; trace: Array<{ time: number; value: LogicValue }>; maxTime: number; row: number }) {
  const current = valueAt(trace, maxTime);
  const oscillating = result.status === "oscillating" && result.changedNodes.includes(nodeId);
  return <path className={`signal signal-current signal-${String(current)}${oscillating ? " signal-oscillating" : ""}`} d={buildPath(trace, maxTime, row)} />;
}
