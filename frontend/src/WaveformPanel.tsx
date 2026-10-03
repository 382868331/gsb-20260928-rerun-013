import { useEffect, useMemo, useRef } from "react";
import { Crosshair, ZoomIn, ZoomOut } from "lucide-react";
import { shortFingerprint } from "./fingerprint";
import type { LogicValue, SimulationResult } from "./types";
import { valueAtTime, type WaveformSelection } from "./waveform";

const rowHeight = 44;
const leftWidth = 118;
const chartHeight = 24;
const baseChartWidth = 1000 - leftWidth;

function buildPath(trace: Array<{ time: number; value: LogicValue }>, maxTime: number, row: number) {
  const width = baseChartWidth;
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
  commands.push(`L ${leftWidth + width} ${y(valueAtTime(trace, maxTime))}`);
  return commands.join(" ");
}

type BaselineLike = {
  label: string;
  fingerprint: string;
  result: SimulationResult;
  planName?: string;
};

type Props = {
  result: SimulationResult | null;
  baseline?: BaselineLike | null;
  cursorTime: number;
  zoom: number;
  selection: WaveformSelection | null;
  panelOpen: boolean;
  panelWidth: number;
  onCursor: (time: number) => void;
  onSelect: (selection: WaveformSelection) => void;
  onZoom: (zoom: number) => void;
};

export function WaveformPanel({ result, baseline, cursorTime, zoom, selection, panelOpen, panelWidth, onCursor, onSelect, onZoom }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const shown = result ?? baseline?.result ?? null;
  const rows = useMemo(() => Array.from(new Set([
    ...Object.keys(result?.waveforms ?? {}),
    ...Object.keys(baseline?.result.waveforms ?? {}),
  ])).sort(), [result, baseline]);
  const maxTime = Math.max(result?.maxTime ?? 0, baseline?.result.maxTime ?? 0, 1);
  const selectedIndex = selection ? rows.indexOf(selection.nodeId) : -1;

  useEffect(() => {
    if (!selection || !wrapRef.current || selectedIndex < 0) return;
    const container = wrapRef.current;
    const rowTop = selectedIndex * rowHeight;
    const markerX = (leftWidth + Math.min(selection.time, maxTime) / maxTime * baseChartWidth) * zoom;
    container.scrollTo({
      left: Math.max(0, markerX - container.clientWidth * 0.35),
      top: Math.max(0, rowTop - container.clientHeight / 2),
      behavior: "smooth",
    });
  }, [selection, selectedIndex, maxTime, zoom, panelOpen, panelWidth]);

  if (!shown) return <div className="empty-panel">运行后在这里查看真实事件生成的波形。</div>;

  const svgWidth = 1000 * zoom;
  const xForTime = (time: number) => (leftWidth + Math.min(Math.max(time, 0), maxTime) / maxTime * baseChartWidth) * zoom;
  const cursorX = xForTime(cursorTime);
  const markerX = selection && selection.time <= maxTime ? xForTime(selection.time) : null;
  const selectAt = (event: React.MouseEvent<SVGGElement>, nodeId: string) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    const svgX = (event.clientX - rect.left) / rect.width * svgWidth;
    const time = Math.round(Math.max(0, Math.min(maxTime, (svgX - leftWidth * zoom) / (baseChartWidth * zoom) * maxTime)));
    if (!result) return;
    onSelect({ time, nodeId, fingerprint: result.fingerprint, reason: "手动选择波形时刻" });
  };

  return (
    <div className="waveform-panel">
      <div className="waveform-toolbar">
        <span>光标 t={cursorTime}</span>
        <span>{selection && markerX !== null ? `选择：${selection.nodeId} t=${selection.time} · ${selection.reason}` : "点击波形行选择节点和时刻"}</span>
        <button onClick={() => onZoom(Math.max(1, zoom / 1.5))} disabled={zoom <= 1} title="缩小波形"><ZoomOut size={13} /></button>
        <button onClick={() => onZoom(Math.min(20, zoom * 1.5))} disabled={zoom >= 20} title="放大波形"><ZoomIn size={13} /></button>
      </div>
      <div className="waveform-wrap" ref={wrapRef}>
        {baseline && (
          <div className="wave-legend">
            <span className="legend-current">— 当前修订 {result ? shortFingerprint(result.fingerprint) : "（未运行）"}</span>
            <span className="legend-baseline">-- 基线 {baseline.label} {shortFingerprint(baseline.fingerprint)}</span>
          </div>
        )}
        <svg
          viewBox={`0 0 ${svgWidth} ${rows.length * rowHeight + 26}`}
          width={svgWidth}
          role="img"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const svgX = (event.clientX - rect.left) / rect.width * svgWidth;
            onCursor(Math.max(0, Math.min(maxTime, (svgX - leftWidth * zoom) / (baseChartWidth * zoom) * maxTime)));
          }}
        >
          {[0, 25, 50, 75, 100].map((percent) => {
            const x = (leftWidth + percent * baseChartWidth / 100) * zoom;
            return (
              <g key={percent}>
                <line className="grid" x1={x} x2={x} y1={0} y2={rows.length * rowHeight} />
                <text className="axis" x={x} y={rows.length * rowHeight + 18}>{Math.round(maxTime * percent / 100)}</text>
              </g>
            );
          })}
          <line className="cursor-line" x1={cursorX} x2={cursorX} y1={0} y2={rows.length * rowHeight} />
          {markerX !== null && selectedIndex >= 0 && <line className="selection-line" x1={markerX} x2={markerX} y1={selectedIndex * rowHeight} y2={(selectedIndex + 1) * rowHeight} />}
          {rows.map((nodeId, index) => (
            <g
              key={nodeId}
              className={selection?.nodeId === nodeId ? "wave-row selected" : "wave-row"}
              onClick={(event) => selectAt(event, nodeId)}
            >
              <rect className="row-hit" x={0} y={index * rowHeight} width={svgWidth} height={rowHeight} />
              <line className="row-grid" x1={leftWidth * zoom} x2={svgWidth} y1={index * rowHeight + 22} y2={index * rowHeight + 22} />
              <text className="wave-name" x={8 * zoom} y={index * rowHeight + 26}>{nodeId}</text>
              {baseline?.result.waveforms[nodeId] && (
                <path className="signal signal-baseline" d={buildPath(baseline.result.waveforms[nodeId], maxTime, index)} transform={`scale(${zoom} 1)`} transform-origin="0 0" />
              )}
              {result?.waveforms[nodeId] ? (
                <SignalPath result={result} nodeId={nodeId} trace={result.waveforms[nodeId]} maxTime={maxTime} row={index} zoom={zoom} />
              ) : (
                <text className="axis missing" x={(leftWidth + 8) * zoom} y={index * rowHeight + 26}>当前结果无此节点</text>
              )}
              {selection?.nodeId === nodeId && markerX !== null && (
                <g transform={`translate(${markerX} ${index * rowHeight + 12})`}>
                  <circle className="selection-dot" r={5} />
                  <Crosshair className="selection-icon" size={14} x={-7} y={-7} />
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>
      {selection && <div className="selection-reason">依据：{selection.reason}，结果指纹 {shortFingerprint(selection.fingerprint)}，节点 {selection.nodeId}，t={selection.time}</div>}
    </div>
  );
}

function SignalPath({ result, nodeId, trace, maxTime, row, zoom }: { result: SimulationResult; nodeId: string; trace: Array<{ time: number; value: LogicValue }>; maxTime: number; row: number; zoom: number }) {
  const current = valueAtTime(trace, maxTime);
  const oscillating = result.status === "oscillating" && result.changedNodes.includes(nodeId);
  return (
    <path
      className={`signal signal-current signal-${String(current)}${oscillating ? " signal-oscillating" : ""}`}
      d={buildPath(trace, maxTime, row)}
      transform={`scale(${zoom} 1)`}
      transform-origin="0 0"
    />
  );
}
