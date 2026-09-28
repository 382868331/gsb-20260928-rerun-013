import React from 'react';

const ROW_H = 44;
const LABEL_W = 130;
const PAD_T = 18;

const Y = { '1': 8, '0': 30, X: 19, E: 19 };
const COLOR = { '1': '#4ade80', '0': '#94a3b8', X: '#f59e0b', E: '#ef4444' };

export default function Waveform({ traces, duration, labels }) {
  const ids = Object.keys(traces || {});
  if (ids.length === 0) return <div className="wave-empty">点击「运行仿真」查看波形</div>;
  const W = 760;
  const H = ids.length * ROW_H + PAD_T + 16;
  const x = (t) => LABEL_W + (Math.max(0, t) / duration) * (W - LABEL_W - 10);
  const ticks = 10;

  return (
    <svg className="wave-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const t = Math.round((duration * i) / ticks);
        const xx = x(t);
        return (
          <g key={i}>
            <line x1={xx} y1={PAD_T} x2={xx} y2={H - 14} className="grid-line" />
            <text x={xx} y={PAD_T - 6} className="grid-text" textAnchor="middle">{t}</text>
          </g>
        );
      })}
      {ids.map((id, row) => {
        const trace = traces[id];
        const yBase = PAD_T + row * ROW_H;
        const elems = [];
        for (let i = 0; i < trace.length; i++) {
          const t0 = trace[i][0];
          const t1 = i + 1 < trace.length ? trace[i + 1][0] : duration;
          const v = trace[i][1];
          const x0 = x(t0);
          const x1 = x(t1);
          const yy = yBase + Y[v];
          if (v === 'X' || v === 'E') {
            elems.push(
              <rect key={`r${i}`} x={x0} y={yy - 7} width={Math.max(1, x1 - x0)} height={14}
                className={v === 'E' ? 'seg-e' : 'seg-x'} />
            );
          } else {
            elems.push(
              <line key={`h${i}`} x1={x0} y1={yy} x2={x1} y2={yy}
                stroke={COLOR[v]} strokeWidth={2} />
            );
          }
          if (i + 1 < trace.length) {
            const nv = trace[i + 1][1];
            elems.push(
              <line key={`v${i}`} x1={x1} y1={yBase + Y[v]} x2={x1} y2={yBase + Y[nv]}
                stroke="#64748b" strokeWidth={1} />
            );
          }
        }
        return (
          <g key={id}>
            <rect x={0} y={yBase} width={W} height={ROW_H} className={row % 2 ? 'row-alt' : 'row'} />
            <text x={6} y={yBase + ROW_H / 2 + 4} className="wave-label">{labels[id] || id}</text>
            {elems}
          </g>
        );
      })}
    </svg>
  );
}
