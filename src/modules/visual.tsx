import { useRef } from "react";
import { defineModule, type Instance, type PanelProps } from "../audio/types";
import { disconnectAll, fmt, gain, noteName, rms } from "../audio/util";
import { useAnimationFrame } from "../components/hooks";

type AnalyserInstance = Instance & { analyser: AnalyserNode; params: { time: number; gain: number } };

// Every visual module passes its input straight through to `thru`.
function analyserInstance(ctx: AudioContext, fftSize: number): AnalyserInstance {
  const input = gain(ctx);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.7;
  input.connect(analyser);
  const buf = new Float32Array(fftSize);
  const params = { time: 20, gain: 1 };
  return {
    inputs: { in: input },
    outputs: { thru: input },
    analyser,
    params,
    set(k, v) {
      if (k === "time") params.time = v as number;
      if (k === "gain") params.gain = v as number;
    },
    meter: () => Math.min(1, rms(analyser, buf) * 5),
    dispose: () => disconnectAll(input, analyser),
  };
}

function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  useAnimationFrame(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
  });
  return ref;
}

function ScopePanel({ instance, compact, color }: PanelProps<AnalyserInstance>) {
  const buf = useRef(new Float32Array(instance.analyser.fftSize));
  const ref = useCanvas((g, w, h) => {
    const data = buf.current;
    instance.analyser.getFloatTimeDomainData(data);
    const sr = instance.analyser.context.sampleRate;
    const span = Math.min(data.length / 2, Math.floor((instance.params.time / 1000) * sr));
    // Trigger on a rising zero crossing so periodic waves stand still.
    let start = 0;
    for (let i = 1; i < data.length - span; i++) {
      if (data[i - 1] < 0 && data[i] >= 0) {
        start = i;
        break;
      }
    }
    g.strokeStyle = "#ececec";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.beginPath();
    for (let x = 0; x < w; x++) {
      const v = data[start + Math.floor((x / w) * span)] * instance.params.gain;
      const y = h / 2 - Math.max(-1, Math.min(1, v)) * (h / 2 - 2);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  });
  return <canvas ref={ref} className="screen" style={{ height: compact ? 48 : 96 }} />;
}

const scope = defineModule<AnalyserInstance>({
  kind: "scope",
  title: "scope",
  category: "visual",
  description: "Oscilloscope. Works on audio and on control signals.",
  width: 240,
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "thru", label: "thru" }],
  params: {
    time: { type: "knob", label: "time", min: 1, max: 200, default: 20, log: true, format: (v) => `${v.toFixed(v < 10 ? 1 : 0)} ms` },
    gain: { type: "knob", label: "zoom", min: 0.25, max: 8, default: 1, log: true, format: fmt.x },
  },
  compact: [],
  Panel: ScopePanel,
  create: (ctx) => analyserInstance(ctx, 16384),
});

function SpectrumPanel({ instance, compact, color }: PanelProps<AnalyserInstance>) {
  const buf = useRef(new Uint8Array(instance.analyser.frequencyBinCount));
  const ref = useCanvas((g, w, h) => {
    const data = buf.current;
    instance.analyser.getByteFrequencyData(data);
    const nyquist = instance.analyser.context.sampleRate / 2;
    const bars = Math.floor(w / 4);
    g.fillStyle = color;
    // Log-spaced bars from 30 Hz to 16 kHz.
    for (let b = 0; b < bars; b++) {
      const f0 = 30 * Math.pow(16000 / 30, b / bars);
      const f1 = 30 * Math.pow(16000 / 30, (b + 1) / bars);
      const i0 = Math.floor((f0 / nyquist) * data.length);
      const i1 = Math.max(i0 + 1, Math.floor((f1 / nyquist) * data.length));
      let peak = 0;
      for (let i = i0; i < i1; i++) peak = Math.max(peak, data[i]);
      const bh = (peak / 255) * h;
      g.fillRect(b * 4, h - bh, 3, bh);
    }
  });
  return <canvas ref={ref} className="screen" style={{ height: compact ? 48 : 96 }} />;
}

const spectrum = defineModule<AnalyserInstance>({
  kind: "spectrum",
  title: "spectrum",
  category: "visual",
  description: "Frequency analyzer, 30 Hz – 16 kHz on a log scale.",
  width: 240,
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "thru", label: "thru" }],
  params: {},
  compact: [],
  Panel: SpectrumPanel,
  create: (ctx) => analyserInstance(ctx, 4096),
});

// Autocorrelation pitch detection; returns Hz or null.
function detectPitch(data: Float32Array, sampleRate: number) {
  const n = data.length;
  let energy = 0;
  for (const s of data) energy += s * s;
  if (Math.sqrt(energy / n) < 0.01) return null;
  const maxLag = Math.min(n / 2, Math.floor(sampleRate / 40));
  const minLag = Math.floor(sampleRate / 2000);
  const corr = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n - maxLag; i++) s += data[i] * data[i + lag];
    corr[lag] = s;
  }
  // First peak above 90% of the best one avoids octave errors.
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, corr[lag]);
  if (best <= 0) return null;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > 0.9 * best && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      // Parabolic interpolation for sub-sample accuracy.
      const a = corr[lag - 1];
      const b = corr[lag];
      const c = corr[lag + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return sampleRate / (lag + shift);
    }
  }
  return null;
}

function TunerPanel({ instance, compact }: PanelProps<AnalyserInstance>) {
  const note = useRef<HTMLDivElement>(null);
  const hz = useRef<HTMLDivElement>(null);
  const needle = useRef<HTMLSpanElement>(null);
  const buf = useRef(new Float32Array(instance.analyser.fftSize));
  const frame = useRef(0);
  useAnimationFrame(() => {
    if (frame.current++ % 3) return; // ~20 Hz is plenty
    instance.analyser.getFloatTimeDomainData(buf.current);
    const f = detectPitch(buf.current, instance.analyser.context.sampleRate);
    if (!note.current || !hz.current || !needle.current) return;
    if (!f) {
      note.current.textContent = "—";
      hz.current.textContent = "";
      needle.current.style.opacity = "0";
      return;
    }
    const midi = 12 * Math.log2(f / 440) + 69;
    const cents = (midi - Math.round(midi)) * 100;
    note.current.textContent = noteName(440 * Math.pow(2, (Math.round(midi) - 69) / 12));
    hz.current.textContent = `${f.toFixed(1)} Hz  ${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`;
    needle.current.style.opacity = "1";
    needle.current.style.left = `${50 + cents}%`;
    needle.current.classList.toggle("in-tune", Math.abs(cents) < 5);
  });
  return (
    <div className="tuner">
      <div ref={note} className="tuner-note">
        —
      </div>
      {!compact && <div ref={hz} className="tuner-hz" />}
      <div className="tuner-scale">
        <span ref={needle} className="tuner-needle" />
      </div>
    </div>
  );
}

const tuner = defineModule<AnalyserInstance>({
  kind: "tuner",
  title: "tuner",
  category: "visual",
  description: "Shows the note of whatever comes in.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "thru", label: "thru" }],
  params: {},
  compact: [],
  Panel: TunerPanel,
  create: (ctx) => analyserInstance(ctx, 2048),
});

export const visualModules = [scope, spectrum, tuner];
