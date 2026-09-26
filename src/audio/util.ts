// Small helpers shared by module definitions.

const sinks = new WeakMap<BaseAudioContext, GainNode>();

// A silent path to the destination. Worklets hang off it so they keep processing
// (and reporting to the UI) even when nothing downstream is patched.
export function sink(ctx: BaseAudioContext) {
  let s = sinks.get(ctx);
  if (!s) {
    s = ctx.createGain();
    s.gain.value = 0;
    s.connect(ctx.destination);
    sinks.set(ctx, s);
  }
  return s;
}

export function worklet(ctx: AudioContext, name: string, options: AudioWorkletNodeOptions = {}) {
  const node = new AudioWorkletNode(ctx, name, options);
  for (let i = 0; i < node.numberOfOutputs; i++) node.connect(sink(ctx), i);
  return node;
}

export function constant(ctx: BaseAudioContext, value = 0) {
  const c = ctx.createConstantSource();
  c.offset.value = value;
  c.start();
  return c;
}

export function gain(ctx: BaseAudioContext, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

// Glide a param to a value without zipper noise. A start time in the past means "now".
export function glide(param: AudioParam, value: number, time = 0.01) {
  param.setTargetAtTime(value, 0, time);
}

export function disconnectAll(...nodes: (AudioNode | undefined)[]) {
  for (const n of nodes) {
    try {
      n?.disconnect();
    } catch {
      // already disconnected
    }
  }
}

export function stopAll(...nodes: (AudioScheduledSourceNode | undefined)[]) {
  for (const n of nodes) {
    try {
      n?.stop();
    } catch {
      // never started / already stopped
    }
  }
}

// RMS level (0..~1) of whatever an analyser is seeing.
export function rms(analyser: AnalyserNode, buf = new Float32Array(analyser.fftSize)) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const s of buf) sum += s * s;
  return Math.sqrt(sum / buf.length);
}

// ---- formatting ----

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const C4 = 261.6256;

export function midiName(n: number) {
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

export function noteName(hz: number) {
  const midi = 12 * Math.log2(hz / 440) + 69;
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  return cents === 0 ? midiName(n) : `${midiName(n)} ${cents > 0 ? "+" : ""}${cents}¢`;
}

export const fmt = {
  hz: (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + " kHz" : v < 100 ? v.toFixed(1) + " Hz" : Math.round(v) + " Hz"),
  pct: (v: number) => Math.round(v * 100) + "%",
  sec: (v: number) => (v < 1 ? Math.round(v * 1000) + " ms" : v.toFixed(2) + " s"),
  db: (v: number) => Math.round(v) + " dB",
  semis: (v: number) => (v > 0 ? "+" : "") + Math.round(v) + " st",
  ratio: (v: number) => v.toFixed(1) + ":1",
  bpm: (v: number) => Math.round(v) + " bpm",
  signed: (v: number) => (v > 0 ? "+" : "") + v.toFixed(2),
  x: (v: number) => v.toFixed(1) + "×",
  oct: (v: number) => (v > 0 ? "+" : "") + v.toFixed(1) + " oct",
};

// Plain gain node whose .gain is the given value, wired src -> this -> dst.
export function scaled(ctx: BaseAudioContext, amount: number, dst: AudioNode | AudioParam) {
  const g = gain(ctx, amount);
  if (dst instanceof AudioParam) g.connect(dst);
  else g.connect(dst);
  return g;
}

// Waveform icons (20×16 viewBox) shared by oscillator-like modules.
export const WAVE_OPTIONS = [
  { value: "sine", label: "sine", icon: "M1 8 C4 -2 8 -2 10 8 S16 18 19 8" },
  { value: "triangle", label: "triangle", icon: "M1 8 L5.5 2 L14.5 14 L19 8" },
  { value: "sawtooth", label: "saw", icon: "M1 13 L10 3 L10 13 L19 3 L19 13" },
  { value: "square", label: "square", icon: "M1 13 L1 3 L10 3 L10 13 L19 13 L19 3" },
];

// Minimal observable value, for instance state that custom panels render.
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = () => this.value;
  set(v: T) {
    this.value = v;
    this.listeners.forEach((fn) => fn());
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
}
