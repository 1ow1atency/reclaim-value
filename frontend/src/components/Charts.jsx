import { useState } from 'react';
import { kg } from '../api';
import { MATERIAL_NAMES, Swatch } from './MaterialTag';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => MONTHS[Number(key.slice(5)) - 1];

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Single-series column chart (one hue, no legend), hover tooltip per column.
export function MonthlyColumns({ data, valueKey, unitFormat = kg, label }) {
  const [hover, setHover] = useState(null);
  const W = 560; const H = 200; const padL = 48; const padB = 26; const padT = 12;
  const max = niceMax(Math.max(...data.map((d) => d[valueKey]), 0));
  const bw = (W - padL) / data.length;
  const y = (v) => H - padB - ((H - padB - padT) * v) / max;
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="#DCDFDB" strokeWidth="1" />
            <text x={padL - 8} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="#5B6267">{unitFormat(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw;
          const h = H - padB - y(d[valueKey]);
          const w = Math.min(bw - 14, 44);
          const cx = x + (bw - w) / 2;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {d[valueKey] > 0 && (
                <path
                  d={`M${cx},${H - padB} v${-Math.max(h - 4, 0)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${Math.max(h - 4, 0)} z`}
                  fill={hover === i ? '#175650' : '#1E6E66'}
                />
              )}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#5B6267">{monthLabel(d.month)}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded bg-graphite-900 px-2 py-1 text-xs text-white" style={{ left: `${((padL + (hover + 0.5) * bw) / W) * 100}%`, transform: 'translateX(-50%)' }}>
          {monthLabel(data[hover].month)} {data[hover].month.slice(0, 4)}: {unitFormat(data[hover][valueKey])}
        </div>
      )}
    </figure>
  );
}

// Horizontal bars by material; the material name and swatch carry identity,
// bars are one hue so magnitude is the only thing colour says.
export function MaterialBars({ data, valueKey, unitFormat = kg }) {
  const rows = [...data].filter((d) => d[valueKey] > 0).sort((a, b) => b[valueKey] - a[valueKey]);
  const max = Math.max(...rows.map((r) => r[valueKey]), 1);
  if (!rows.length) return <p className="text-sm text-graphite-500">Nothing recorded yet.</p>;
  return (
    <dl className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.material} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm" title={`${MATERIAL_NAMES[r.material]}: ${unitFormat(r[valueKey])}`}>
          <dt className="flex items-center gap-1.5 font-semibold"><Swatch material={r.material} />{MATERIAL_NAMES[r.material]}</dt>
          <dd className="h-3" aria-hidden>
            <div className="h-3 rounded-r" style={{ width: `${(r[valueKey] / max) * 100}%`, background: '#1E6E66', minWidth: 3 }} />
          </dd>
          <dd className="figure text-right">{unitFormat(r[valueKey])}</dd>
        </div>
      ))}
    </dl>
  );
}
