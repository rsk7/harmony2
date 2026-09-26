import { useRef, useState } from "react";
import { defineModule, type Instance, type PanelProps, type ParamValue } from "../audio/types";
import { C4, disconnectAll, fmt, gain, glide, noteName, rms, scaled, stopAll, Store, WAVE_OPTIONS, worklet } from "../audio/util";
import { useStore } from "../components/hooks";
import wavetables from "../data/wavetables.json";

// ---- oscillator & wavetable ----

// A free-running oscillator behind a gate. The gate is open while `on` is set or a
// bound key is held; OscillatorNodes can only start once, so we never stop it.
function oscillatorVoice(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  osc.frequency.value = C4;
  const gate = gain(ctx, 0);
  const level = gain(ctx, 0.5);
  osc.connect(gate).connect(level);
  const pitch = scaled(ctx, 1200, osc.detune); // 1 unit = 1 octave
  const fm = scaled(ctx, 200, osc.frequency); // 1 unit = 200 Hz
  osc.start();

  let on = true;
  let held = 0;
  let key: string | null = null;

  const applyGate = () => {
    const open = on || held > 0;
    const g = gate.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(open ? 1 : 0, now + (open ? 0.005 : 0.03));
  };

  return {
    osc,
    inputs: { pitch, fm },
    outputs: { out: level },
    set(k: string, v: ParamValue) {
      if (k === "freq") glide(osc.frequency, v as number);
      else if (k === "level") glide(level.gain, v as number);
      else if (k === "wave") osc.type = v as OscillatorType;
      else if (k === "on") {
        on = v as boolean;
        applyGate();
      } else if (k === "key") key = v as string | null;
    },
    meter: () => (on || held > 0 ? 1 : 0),
    onKey(k: string, down: boolean) {
      if (k !== key) return false;
      held = Math.max(0, held + (down ? 1 : -1));
      applyGate();
      return true;
    },
    releaseKeys() {
      held = 0;
      applyGate();
    },
    dispose() {
      stopAll(osc);
      disconnectAll(osc, gate, level, pitch, fm);
    },
  } satisfies Instance & { osc: OscillatorNode };
}

const pitchParams = {
  freq: {
    type: "knob" as const,
    label: "freq",
    min: 20,
    max: 4000,
    default: C4,
    log: true,
    format: fmt.hz,
    sub: noteName,
  },
  level: { type: "knob" as const, label: "level", min: 0, max: 1, default: 0.5, format: fmt.pct },
  on: { type: "toggle" as const, label: "on", default: true },
  key: { type: "key" as const, label: "key", default: null, onBind: { on: false } },
};

const oscPorts = {
  inputs: [
    { id: "pitch", label: "pitch" },
    { id: "fm", label: "fm" },
  ],
  outputs: [{ id: "out", label: "out" }],
};

const oscillator = defineModule({
  kind: "oscillator",
  title: "oscillator",
  category: "sources",
  description: "Basic waveforms. pitch in: 1 unit per octave.",
  ...oscPorts,
  params: {
    wave: { type: "choice", label: "wave", default: "sine", options: WAVE_OPTIONS },
    ...pitchParams,
  },
  compact: ["freq", "on"],
  create: oscillatorVoice,
});

type TableName = keyof typeof wavetables;
const TABLE_NAMES = Object.keys(wavetables) as TableName[];

const wavetable = defineModule({
  kind: "wavetable",
  title: "wavetable",
  category: "sources",
  description: "Harmony's sampled wavetables: piano, organ, wurlitzer…",
  ...oscPorts,
  params: {
    table: {
      type: "choice",
      label: "table",
      default: "piano",
      options: TABLE_NAMES.map((t) => ({ value: t, label: t })),
    },
    ...pitchParams,
  },
  compact: ["freq", "on"],
  create(ctx) {
    const voice = oscillatorVoice(ctx);
    const setBase = voice.set;
    return {
      ...voice,
      set(k: string, v: ParamValue) {
        if (k === "table") {
          const t = wavetables[v as TableName] ?? wavetables.piano;
          voice.osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(t.real), new Float32Array(t.imag)));
        } else setBase(k, v);
      },
    };
  },
});

// ---- noise ----

const noiseBuffers = new WeakMap<BaseAudioContext, Record<string, AudioBuffer>>();

function makeNoise(ctx: BaseAudioContext) {
  let cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const len = ctx.sampleRate * 4;
  const make = (fill: (d: Float32Array) => void) => {
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    fill(b.getChannelData(0));
    return b;
  };
  cached = {
    white: make((d) => {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }),
    // Paul Kellet's economy pink filter.
    pink: make((d) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }),
    brown: make((d) => {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }),
  };
  noiseBuffers.set(ctx, cached);
  return cached;
}

const noise = defineModule({
  kind: "noise",
  title: "noise",
  category: "sources",
  description: "White, pink or brown noise.",
  inputs: [],
  outputs: [{ id: "out", label: "out" }],
  params: {
    color: {
      type: "choice",
      label: "color",
      default: "white",
      options: [
        { value: "white", label: "white" },
        { value: "pink", label: "pink" },
        { value: "brown", label: "brown" },
      ],
    },
    level: { type: "knob", label: "level", min: 0, max: 1, default: 0.3, format: fmt.pct },
  },
  compact: ["level"],
  create(ctx) {
    const level = gain(ctx, 0.3);
    let src: AudioBufferSourceNode | undefined;
    return {
      inputs: {},
      outputs: { out: level },
      set(k, v) {
        if (k === "level") glide(level.gain, v as number);
        if (k === "color") {
          stopAll(src);
          disconnectAll(src);
          src = ctx.createBufferSource();
          src.buffer = makeNoise(ctx)[v as string] ?? makeNoise(ctx).white;
          src.loop = true;
          src.connect(level);
          src.start();
        }
      },
      dispose() {
        stopAll(src);
        disconnectAll(src, level);
      },
    };
  },
});

// ---- sampler ----

// A short synthesized bell so the sampler makes sound before anything is loaded.
function builtInSample(ctx: BaseAudioContext) {
  const len = Math.floor(ctx.sampleRate * 1.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  const partials = [
    [1, 1, 1.2],
    [2.76, 0.5, 0.6],
    [5.4, 0.25, 0.3],
    [8.93, 0.12, 0.15],
  ];
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    let s = 0;
    for (const [ratio, amp, decay] of partials) s += Math.sin(2 * Math.PI * C4 * ratio * t) * amp * Math.exp(-t / decay);
    d[i] = s * 0.4 * Math.min(1, t * 500);
  }
  return b;
}

type SamplerInstance = Instance & {
  sample: Store<{ name: string; buffer: AudioBuffer }>;
  load(file: File): Promise<void>;
  trigger(on: boolean): void;
};

function SamplerPanel({ instance, compact }: PanelProps<SamplerInstance>) {
  const { name, buffer } = useStore(instance.sample);
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    instance.load(f).catch(() => setError("couldn't decode that file"));
  };

  return (
    <div
      className={`sample-drop nodrag${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        load(e.dataTransfer.files[0]);
      }}
    >
      <Waveform buffer={buffer} height={compact ? 28 : 44} />
      <div className="sample-name" title={name}>
        {error ?? name}
      </div>
      {!compact && (
        <div className="sample-actions">
          <button onClick={() => fileInput.current?.click()}>load…</button>
          <button onPointerDown={() => instance.trigger(true)} onPointerUp={() => instance.trigger(false)}>
            play
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => load(e.target.files?.[0])}
          />
        </div>
      )}
    </div>
  );
}

function Waveform({ buffer, height }: { buffer: AudioBuffer; height: number }) {
  const width = 170;
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / width));
  let path = "";
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let i = x * step; i < (x + 1) * step && i < d.length; i += 4) peak = Math.max(peak, Math.abs(d[i]));
    const h = Math.max(0.5, peak * (height / 2));
    path += `M${x} ${height / 2 - h}V${height / 2 + h}`;
  }
  return (
    <svg className="waveform" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={path} />
    </svg>
  );
}

const sampler = defineModule<SamplerInstance>({
  kind: "sampler",
  title: "sampler",
  category: "sources",
  description: "Play an audio file. Drop a file on it or load one; trigger from a gate or key.",
  width: 220,
  inputs: [
    { id: "trig", label: "trig" },
    { id: "pitch", label: "pitch" },
  ],
  outputs: [{ id: "out", label: "out" }],
  params: {
    mode: {
      type: "choice",
      label: "mode",
      default: "oneshot",
      options: [
        { value: "oneshot", label: "one-shot" },
        { value: "gate", label: "gate" },
        { value: "loop", label: "loop" },
      ],
    },
    tune: { type: "knob", label: "tune", min: -24, max: 24, default: 0, step: 1, format: fmt.semis },
    level: { type: "knob", label: "level", min: 0, max: 1, default: 0.8, format: fmt.pct },
    key: { type: "key", label: "key", default: null },
  },
  compact: [],
  Panel: SamplerPanel,
  create(ctx) {
    const level = gain(ctx, 0.8);
    const pitch = gain(ctx, 1200);
    const watch = worklet(ctx, "gate-watch", { numberOfInputs: 1, numberOfOutputs: 1 });
    const sample = new Store({ name: "bell (built-in)", buffer: builtInSample(ctx) });
    const playing = new Set<AudioBufferSourceNode>();
    let mode = "oneshot";
    let tune = 0;
    let key: string | null = null;

    const trigger = (on: boolean) => {
      if (on) {
        if (mode !== "oneshot") release();
        const src = ctx.createBufferSource();
        src.buffer = sample.get().buffer;
        src.loop = mode === "loop";
        src.detune.value = tune * 100;
        pitch.connect(src.detune);
        src.connect(level);
        src.onended = () => {
          playing.delete(src);
          disconnectAll(src);
        };
        src.start();
        playing.add(src);
      } else if (mode !== "oneshot") release();
    };
    const release = () => {
      playing.forEach((s) => stopAll(s));
    };
    watch.port.onmessage = (e) => trigger(e.data as boolean);

    return {
      inputs: { trig: watch, pitch },
      outputs: { out: level },
      sample,
      async load(file: File) {
        const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
        sample.set({ name: file.name, buffer });
      },
      trigger,
      set(k, v) {
        if (k === "mode") {
          mode = v as string;
          release();
        } else if (k === "tune") tune = v as number;
        else if (k === "level") glide(level.gain, v as number);
        else if (k === "key") key = v as string | null;
      },
      meter: () => (playing.size > 0 ? 1 : 0),
      onKey(k, down) {
        if (k !== key) return false;
        trigger(down);
        return true;
      },
      dispose() {
        release();
        watch.port.onmessage = null;
        disconnectAll(watch, pitch, level);
      },
    };
  },
});

// ---- microphone ----

type MicInstance = Instance & {
  state: Store<"off" | "asking" | "on" | "denied">;
  enable(): Promise<void>;
};

function MicPanel({ instance, compact }: PanelProps<MicInstance>) {
  const state = useStore(instance.state);
  if (state === "on") return compact ? null : <div className="note">⚠ use headphones to avoid feedback</div>;
  return (
    <div className="nodrag mic-enable">
      <button disabled={state === "asking"} onClick={() => void instance.enable()}>
        {state === "denied" ? "mic blocked, retry" : state === "asking" ? "waiting…" : "enable mic"}
      </button>
    </div>
  );
}

const mic = defineModule<MicInstance>({
  kind: "mic",
  title: "microphone",
  category: "sources",
  description: "Live input from your microphone.",
  inputs: [],
  outputs: [{ id: "out", label: "out" }],
  params: {
    gain: { type: "knob", label: "gain", min: 0, max: 4, default: 1, format: fmt.x },
  },
  compact: ["gain"],
  Panel: MicPanel,
  create(ctx) {
    const level = gain(ctx, 1);
    const analyser = ctx.createAnalyser();
    level.connect(analyser);
    const state = new Store<"off" | "asking" | "on" | "denied">("off");
    let stream: MediaStream | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let disposed = false;
    const buf = new Float32Array(analyser.fftSize);
    return {
      inputs: {},
      outputs: { out: level },
      state,
      async enable() {
        state.set("asking");
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          if (disposed) return stream.getTracks().forEach((t) => t.stop());
          source = ctx.createMediaStreamSource(stream);
          source.connect(level);
          state.set("on");
        } catch {
          state.set("denied");
        }
      },
      set(k, v) {
        if (k === "gain") glide(level.gain, v as number);
      },
      meter: () => Math.min(1, rms(analyser, buf) * 6),
      dispose() {
        disposed = true;
        stream?.getTracks().forEach((t) => t.stop());
        disconnectAll(source, level, analyser);
      },
    };
  },
});

export const sourceModules = [oscillator, wavetable, noise, sampler, mic];
