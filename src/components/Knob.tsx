import { useRef } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  log?: boolean;
  step?: number;
  size?: number;
  format?: (v: number) => string;
  sub?: string;
  onChange: (v: number) => void;
};

const SWEEP = 270; // degrees of rotation from min to max

// Normalized 0..1 position <-> value, optionally on a log scale (for frequency).
function toNorm(v: number, min: number, max: number, log?: boolean) {
  const n = log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  return Math.min(1, Math.max(0, n));
}
function fromNorm(n: number, min: number, max: number, log?: boolean) {
  return log ? min * Math.pow(max / min, n) : min + n * (max - min);
}

export function Knob({ label, value, min, max, defaultValue, log, step, size = 44, format, sub, onChange }: Props) {
  const drag = useRef<{ y: number; norm: number } | null>(null);
  const norm = toNorm(value, min, max, log);
  const angle = -SWEEP / 2 + norm * SWEEP;

  const emit = (v: number) => onChange(step ? Math.round(v / step) * step : v);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, norm };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    // 200px of vertical travel covers the full range; shift for fine control.
    const scale = e.shiftKey ? 1000 : 200;
    const n = Math.min(1, Math.max(0, drag.current.norm + (drag.current.y - e.clientY) / scale));
    emit(fromNorm(n, min, max, log));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const n = Math.min(1, Math.max(0, norm - e.deltaY / (e.shiftKey ? 2000 : 400)));
    emit(fromNorm(n, min, max, log));
  };

  return (
    <div className="knob nodrag nowheel">
      <svg
        width={size}
        height={size}
        viewBox="-22 -22 44 44"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => onChange(defaultValue)}
      >
        <title>drag or scroll to adjust · shift for fine · double-click to reset</title>
        <path className="knob-track" d={arc(SWEEP)} />
        <path className="knob-fill" d={arc(norm * SWEEP)} />
        <circle className="knob-body" r="13" />
        <line className="knob-pointer" x1="0" y1="-5" x2="0" y2="-11" transform={`rotate(${angle})`} />
      </svg>
      <div className="knob-value">{format ? format(value) : value.toFixed(2)}</div>
      {sub && <div className="knob-sub">{sub}</div>}
      {label && <div className="knob-label">{label}</div>}
    </div>
  );
}

// Arc of the given sweep starting at the min position, radius 18.
function arc(sweep: number) {
  const r = 18;
  const start = (-SWEEP / 2 - 90) * (Math.PI / 180);
  const end = start + Math.max(sweep, 0.01) * (Math.PI / 180);
  const p = (a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(start)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${p(end)}`;
}
