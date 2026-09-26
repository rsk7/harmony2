import { defineModule, type Instance, type PanelProps, type ParamValue } from "../audio/types";
import { constant, disconnectAll, fmt, gain, glide, midiName, stopAll, Store, WAVE_OPTIONS, worklet } from "../audio/util";
import { useStore } from "../components/hooks";
import { Knob } from "../components/Knob";

// A value that decays after each event, for blinking LEDs on steps and beats.
function flasher() {
  let last = -1;
  return {
    hit: () => (last = performance.now()),
    meter: () => (last < 0 ? 0 : Math.max(0, 1 - (performance.now() - last) / 120)),
  };
}

const param = (node: AudioWorkletNode, name: string) => node.parameters.get(name)!;

// ---- envelope ----

type EnvelopeInstance = Instance & { gate(on: boolean): void; shape: Store<number[]> };

function EnvelopePanel({ instance, compact }: PanelProps<EnvelopeInstance>) {
  const [a, d, s, r] = useStore(instance.shape);
  // Draw the ADSR as a polyline with time on a sqrt scale so short stages stay visible.
  const w = 170;
  const h = compact ? 26 : 40;
  const seg = (t: number) => Math.sqrt(t) * 30;
  const hold = 24;
  const total = seg(a) + seg(d) + hold + seg(r);
  const k = w / total;
  const xs = [0, seg(a), seg(a) + seg(d), seg(a) + seg(d) + hold, total].map((x) => x * k);
  const pts = [
    [xs[0], h],
    [xs[1], 2],
    [xs[2], 2 + (1 - s) * (h - 4)],
    [xs[3], 2 + (1 - s) * (h - 4)],
    [xs[4], h],
  ];
  return (
    <div className="env-panel">
      <svg className="env-shape" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline points={pts.map((p) => p.join(",")).join(" ")} />
      </svg>
      {!compact && (
        <button
          className="push nodrag"
          onPointerDown={() => instance.gate(true)}
          onPointerUp={() => instance.gate(false)}
          onPointerLeave={() => instance.gate(false)}
        >
          gate
        </button>
      )}
    </div>
  );
}

const envelope = defineModule<EnvelopeInstance>({
  kind: "envelope",
  title: "envelope",
  category: "control",
  description: "ADSR, 0..1 out. Opens on a gate (keyboard, sequencer, key or button).",
  inputs: [{ id: "gate", label: "gate" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    attack: { type: "knob", label: "A", min: 0.001, max: 5, default: 0.01, log: true, format: fmt.sec },
    decay: { type: "knob", label: "D", min: 0.005, max: 5, default: 0.25, log: true, format: fmt.sec },
    sustain: { type: "knob", label: "S", min: 0, max: 1, default: 0.6, format: fmt.pct },
    release: { type: "knob", label: "R", min: 0.005, max: 8, default: 0.5, log: true, format: fmt.sec },
    key: { type: "key", label: "key", default: null },
  },
  compact: [],
  width: 250,
  Panel: EnvelopePanel,
  create(ctx) {
    const node = worklet(ctx, "envelope", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    let level = 0;
    node.port.onmessage = (e) => (level = e.data as number);
    const shape = new Store([0.01, 0.25, 0.6, 0.5]);
    const idx: Record<string, number> = { attack: 0, decay: 1, sustain: 2, release: 3 };
    let key: string | null = null;
    const gate = (on: boolean) => node.port.postMessage({ gate: on });
    return {
      inputs: { gate: node },
      outputs: { out: node },
      shape,
      gate,
      set(k, v) {
        if (k in idx) {
          glide(param(node, k), v as number, 0.005);
          const next = [...shape.get()];
          next[idx[k]] = v as number;
          shape.set(next);
        } else if (k === "key") key = v as string | null;
      },
      meter: () => level,
      onKey(k, down) {
        if (k !== key) return false;
        gate(down);
        return true;
      },
      releaseKeys: () => gate(false),
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node);
      },
    };
  },
});

// ---- LFO ----

const lfo = defineModule({
  kind: "lfo",
  title: "lfo",
  category: "control",
  description: "Slow oscillator for vibrato, tremolo and sweeps. ±depth out (or 0..depth).",
  inputs: [],
  outputs: [{ id: "out", label: "out" }],
  params: {
    wave: { type: "choice", label: "wave", default: "sine", options: WAVE_OPTIONS },
    rate: { type: "knob", label: "rate", min: 0.02, max: 40, default: 2, log: true, format: fmt.hz },
    depth: { type: "knob", label: "depth", min: 0, max: 1, default: 0.5, format: fmt.pct },
    unipolar: { type: "toggle", label: "0..1", default: false },
  },
  compact: ["rate", "depth"],
  create(ctx) {
    const osc = ctx.createOscillator();
    osc.frequency.value = 2;
    const depth = gain(ctx, 0.5);
    const offset = constant(ctx, 0);
    const out = gain(ctx, 1);
    osc.connect(depth).connect(out);
    offset.connect(out);
    osc.start();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    out.connect(analyser);
    const buf = new Float32Array(32);
    let unipolar = false;
    let amount = 0.5;
    const apply = () => {
      glide(depth.gain, unipolar ? amount / 2 : amount);
      glide(offset.offset, unipolar ? amount / 2 : 0);
    };
    return {
      inputs: {},
      outputs: { out },
      set(k, v) {
        if (k === "wave") osc.type = v as OscillatorType;
        else if (k === "rate") glide(osc.frequency, v as number);
        else if (k === "depth") amount = v as number;
        else if (k === "unipolar") unipolar = v as boolean;
        apply();
      },
      meter() {
        analyser.getFloatTimeDomainData(buf);
        return amount > 0 ? Math.min(1, Math.abs(buf[buf.length - 1]) / amount) : 0;
      },
      dispose() {
        stopAll(osc, offset);
        disconnectAll(osc, depth, offset, out, analyser);
      },
    };
  },
});

// ---- keyboard ----

// Piano layout on the home row, like harmony: a w s e d f t g y h u j k o l p ;
const KEY_LAYOUT = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k", "o", "l", "p", ";"];
const BLACK = new Set([1, 3, 6, 8, 10, 13, 15]);

type KeyboardInstance = Instance & {
  held: Store<number[]>;
  octave: Store<number>;
  press(note: number): void;
  release(note: number): void;
  shift(by: number): void;
};

function KeyboardPanel({ instance, compact }: PanelProps<KeyboardInstance>) {
  const held = useStore(instance.held);
  const octave = useStore(instance.octave);
  const current = held.at(-1);
  if (compact) {
    return (
      <div className="kbd-compact">
        {current !== undefined ? midiName(60 + octave * 12 + current) : "—"}
        <span className="dim"> oct {octave >= 0 ? "+" : ""}{octave}</span>
      </div>
    );
  }
  const whites = KEY_LAYOUT.map((_, i) => i).filter((i) => !BLACK.has(i));
  const whiteW = 100 / whites.length;
  return (
    <div className="kbd nodrag">
      <div className="kbd-keys">
        {KEY_LAYOUT.map((k, i) => {
          const black = BLACK.has(i);
          const left = black ? whites.indexOf(i - 1) * whiteW + whiteW * 0.65 : whites.indexOf(i) * whiteW;
          return (
            <div
              key={k}
              className={`kbd-key${black ? " black" : ""}${held.includes(i) ? " down" : ""}`}
              style={{ left: `${left}%`, width: `${black ? whiteW * 0.7 : whiteW}%` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                instance.press(i);
              }}
              onPointerUp={() => instance.release(i)}
            >
              <span>{k}</span>
            </div>
          );
        })}
      </div>
      <div className="kbd-octave">
        <button onClick={() => instance.shift(-1)}>z ◀</button>
        <span>
          {midiName(60 + octave * 12)}–{midiName(60 + octave * 12 + 16)}
        </span>
        <button onClick={() => instance.shift(1)}>▶ x</button>
      </div>
    </div>
  );
}

const keyboard = defineModule<KeyboardInstance>({
  kind: "keyboard",
  title: "keyboard",
  category: "control",
  description: "Play from your computer keys (a–; rows, z/x octave). Mono, last-note priority.",
  width: 300,
  compactWidth: 170,
  inputs: [],
  outputs: [
    { id: "pitch", label: "pitch" },
    { id: "gate", label: "gate" },
  ],
  params: {
    glide: { type: "knob", label: "glide", min: 0, max: 1, default: 0, format: fmt.sec },
    keys: { type: "toggle", label: "computer keys", default: true },
  },
  compact: [],
  Panel: KeyboardPanel,
  create(ctx) {
    const pitch = constant(ctx, 0);
    const gateSrc = constant(ctx, 0);
    const held = new Store<number[]>([]);
    const octave = new Store(0);
    let glideTime = 0;
    let keysOn = true;

    const sound = () => {
      const notes = held.get();
      const now = ctx.currentTime;
      const g = gateSrc.offset;
      if (!notes.length) {
        g.cancelScheduledValues(now);
        g.setValueAtTime(0, now);
        return;
      }
      const target = (octave.get() * 12 + notes[notes.length - 1]) / 12;
      pitch.offset.cancelScheduledValues(now);
      if (glideTime > 0 && g.value > 0.5) pitch.offset.setTargetAtTime(target, now, glideTime / 3);
      else pitch.offset.setValueAtTime(target, now);
      // Drop the gate briefly so envelopes retrigger on each new note.
      g.cancelScheduledValues(now);
      g.setValueAtTime(0, now);
      g.setValueAtTime(1, now + 0.004);
    };
    const press = (n: number) => {
      if (held.get().includes(n)) return;
      held.set([...held.get(), n]);
      sound();
    };
    const release = (n: number) => {
      const before = held.get();
      const next = before.filter((x) => x !== n);
      held.set(next);
      if (!next.length) sound();
      else if (before.at(-1) === n) sound();
    };
    return {
      inputs: {},
      outputs: { pitch, gate: gateSrc },
      held,
      octave,
      press,
      release,
      shift(by) {
        octave.set(Math.max(-3, Math.min(3, octave.get() + by)));
      },
      set(k, v) {
        if (k === "glide") glideTime = v as number;
        else if (k === "keys") keysOn = v as boolean;
      },
      meter: () => (held.get().length ? 1 : 0),
      onKey(k, down) {
        if (!keysOn) return false;
        if (down && (k === "z" || k === "x")) {
          this.shift(k === "z" ? -1 : 1);
          return true;
        }
        const n = KEY_LAYOUT.indexOf(k);
        if (n < 0) return false;
        if (down) press(n);
        else release(n);
        return true;
      },
      releaseKeys() {
        held.set([]);
        sound();
      },
      dispose() {
        stopAll(pitch, gateSrc);
        disconnectAll(pitch, gateSrc);
      },
    } satisfies KeyboardInstance;
  },
});

// ---- sequencer ----

const STEPS = 8;

type StepInstance = Instance & { step: Store<number> };

function SequencerPanel({ instance, params, update, compact }: PanelProps<StepInstance>) {
  const current = useStore(instance.step);
  return (
    <div className={`seq nodrag${compact ? " compact" : ""}`}>
      {Array.from({ length: STEPS }, (_, i) => {
        const on = params[`g${i}`] as boolean;
        const semis = params[`s${i}`] as number;
        return (
          <div key={i} className={`seq-step${i === current ? " current" : ""}${on ? "" : " muted"}`}>
            {!compact && (
              <Knob
                label=""
                size={30}
                value={semis}
                min={-12}
                max={12}
                step={1}
                defaultValue={0}
                format={(v) => (v > 0 ? "+" : "") + Math.round(v)}
                onChange={(v) => update({ [`s${i}`]: v })}
              />
            )}
            <button className="seq-gate" onClick={() => update({ [`g${i}`]: !on })} title="toggle step" />
          </div>
        );
      })}
    </div>
  );
}

const sequencer = defineModule<StepInstance>({
  kind: "sequencer",
  title: "sequencer",
  category: "control",
  description: "8 steps of pitch (±12 semitones) and gates, advanced by a clock.",
  width: 330,
  compactWidth: 200,
  inputs: [
    { id: "clock", label: "clk" },
    { id: "reset", label: "rst" },
  ],
  outputs: [
    { id: "pitch", label: "pitch" },
    { id: "gate", label: "gate" },
  ],
  params: {
    ...Object.fromEntries(
      Array.from({ length: STEPS }, (_, i) => [
        `s${i}`,
        { type: "knob" as const, label: "", min: -12, max: 12, default: [0, 3, 7, 10, 12, 10, 7, 3][i], hidden: true },
      ]),
    ),
    ...Object.fromEntries(
      Array.from({ length: STEPS }, (_, i) => [`g${i}`, { type: "toggle" as const, label: "", default: true, hidden: true }]),
    ),
    length: { type: "knob", label: "length", min: 1, max: STEPS, default: STEPS, step: 1, format: (v) => `${Math.round(v)} steps` },
  },
  compact: [],
  Panel: SequencerPanel,
  create(ctx) {
    const node = worklet(ctx, "sequencer", { numberOfInputs: 2, numberOfOutputs: 2, outputChannelCount: [1, 1] });
    const step = new Store(-1);
    const flash = flasher();
    node.port.onmessage = (e) => {
      step.set(e.data as number);
      flash.hit();
    };
    const steps = new Array(STEPS).fill(0);
    const gates = new Array(STEPS).fill(true);
    return {
      inputs: { clock: [node, 0], reset: [node, 1] },
      outputs: { pitch: [node, 0], gate: [node, 1] },
      step,
      set(k: string, v: ParamValue) {
        const m = /^([sg])(\d+)$/.exec(k);
        if (m) {
          (m[1] === "s" ? steps : gates)[+m[2]] = v;
          node.port.postMessage({ steps, gates });
        } else if (k === "length") node.port.postMessage({ length: Math.round(v as number) });
      },
      meter: flash.meter,
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node);
      },
    };
  },
});

// ---- arpeggiator ----

const CHORDS: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  oct: [0],
};

function ArpPanel({ instance, params }: PanelProps<StepInstance>) {
  const current = useStore(instance.step);
  const chord = CHORDS[params.chord as string] ?? CHORDS.maj;
  const octaves = Math.round(params.octaves as number);
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++) for (const s of chord) notes.push(s + 12 * o);
  // Highlight isn't exact for up-down/random patterns; it tracks the worklet's index.
  const seq = params.pattern === "down" ? [...notes].reverse() : notes;
  return (
    <div className="arp-notes">
      {seq.map((n, i) => (
        <span key={i} className={i === current ? "current" : ""} style={{ height: 6 + n * 1.2 }} />
      ))}
    </div>
  );
}

const arpeggiator = defineModule<StepInstance>({
  kind: "arpeggiator",
  title: "arpeggiator",
  category: "control",
  description: "Plays a chord on the incoming root pitch, one note per clock tick, while the gate is held.",
  width: 230,
  inputs: [
    { id: "clock", label: "clk" },
    { id: "pitch", label: "pitch" },
    { id: "gate", label: "gate" },
  ],
  outputs: [
    { id: "pitch", label: "pitch" },
    { id: "gate", label: "gate" },
  ],
  params: {
    chord: {
      type: "choice",
      label: "chord",
      default: "min",
      options: Object.keys(CHORDS).map((c) => ({ value: c, label: c })),
    },
    pattern: {
      type: "choice",
      label: "pattern",
      default: "up",
      options: [
        { value: "up", label: "up" },
        { value: "down", label: "down" },
        { value: "updown", label: "up-dn" },
        { value: "random", label: "rand" },
      ],
    },
    octaves: { type: "knob", label: "octaves", min: 1, max: 4, default: 2, step: 1, format: (v) => `${Math.round(v)}` },
    latch: { type: "toggle", label: "latch", default: false },
  },
  compact: ["chord"],
  Panel: ArpPanel,
  create(ctx) {
    const node = worklet(ctx, "arpeggiator", { numberOfInputs: 3, numberOfOutputs: 2, outputChannelCount: [1, 1] });
    const step = new Store(-1);
    const flash = flasher();
    node.port.onmessage = (e) => {
      step.set(e.data as number);
      flash.hit();
    };
    return {
      inputs: { clock: [node, 0], pitch: [node, 1], gate: [node, 2] },
      outputs: { pitch: [node, 0], gate: [node, 1] },
      step,
      set(k, v) {
        if (k === "chord") node.port.postMessage({ chord: CHORDS[v as string] ?? CHORDS.maj });
        else if (k === "pattern") node.port.postMessage({ pattern: v });
        else if (k === "octaves") node.port.postMessage({ octaves: Math.round(v as number) });
        else if (k === "latch") node.port.postMessage({ latch: v });
      },
      meter: flash.meter,
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node);
      },
    };
  },
});

// ---- clock ----

type ClockInstance = Instance & { beat: Store<number> };

function ClockPanel({ instance }: PanelProps<ClockInstance>) {
  const beat = useStore(instance.beat);
  return (
    <div className="beats">
      {[0, 1, 2, 3].map((b) => (
        <span key={b} className={b === beat ? "current" : ""} />
      ))}
    </div>
  );
}

const clock = defineModule<ClockInstance>({
  kind: "clock",
  title: "clock",
  category: "control",
  description: "Tempo pulses: beat, ×2, ÷2, ÷4. Drives sequencers, arps and the beat grid.",
  inputs: [],
  outputs: [
    { id: "x1", label: "1/4" },
    { id: "x2", label: "1/8" },
    { id: "d2", label: "1/2" },
    { id: "d4", label: "bar" },
  ],
  params: {
    bpm: { type: "knob", label: "tempo", min: 30, max: 300, default: 120, step: 1, format: fmt.bpm },
    run: { type: "toggle", label: "run", default: true },
  },
  compact: ["bpm", "run"],
  Panel: ClockPanel,
  create(ctx) {
    const node = worklet(ctx, "clock", { numberOfInputs: 0, numberOfOutputs: 4, outputChannelCount: [1, 1, 1, 1] });
    const beat = new Store(-1);
    const flash = flasher();
    node.port.onmessage = (e) => {
      beat.set(e.data as number);
      flash.hit();
    };
    return {
      inputs: {},
      outputs: { x1: [node, 0], x2: [node, 1], d2: [node, 2], d4: [node, 3] },
      beat,
      set(k, v) {
        if (k === "bpm") param(node, "bpm").value = v as number;
        else if (k === "run") {
          node.port.postMessage({ run: v });
          if (!v) beat.set(-1);
        }
      },
      meter: flash.meter,
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node);
      },
    };
  },
});

// ---- random (sample & hold) ----

type RandomInstance = Instance & { value: Store<number> };

function RandomPanel({ instance }: PanelProps<RandomInstance>) {
  const v = useStore(instance.value);
  return (
    <div className="bipolar-bar">
      <span style={{ left: v >= 0 ? "50%" : `${50 + v * 50}%`, width: `${Math.abs(v) * 50}%` }} />
    </div>
  );
}

const random = defineModule<RandomInstance>({
  kind: "random",
  title: "random",
  category: "control",
  description: "Sample & hold: a new random value (or a sample of in) on each trigger.",
  inputs: [
    { id: "trig", label: "trig" },
    { id: "in", label: "in" },
  ],
  outputs: [{ id: "out", label: "out" }],
  params: {
    range: { type: "knob", label: "range", min: 0, max: 1, default: 1, format: fmt.pct },
    slew: { type: "knob", label: "slew", min: 0, max: 0.5, default: 0, format: fmt.sec },
  },
  compact: ["range"],
  Panel: RandomPanel,
  create(ctx) {
    const node = worklet(ctx, "sample-hold", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
    const range = gain(ctx, 1);
    // One-pole smoothing via a lowpass; slew 0 bypasses it.
    const smooth = ctx.createBiquadFilter();
    smooth.type = "lowpass";
    smooth.Q.value = 0;
    smooth.frequency.value = 20000;
    node.connect(smooth).connect(range);
    const value = new Store(0);
    const flash = flasher();
    node.port.onmessage = (e) => {
      value.set(e.data as number);
      flash.hit();
    };
    return {
      inputs: { trig: [node, 0], in: [node, 1] },
      outputs: { out: range },
      value,
      set(k, v) {
        if (k === "range") glide(range.gain, v as number);
        else if (k === "slew") glide(smooth.frequency, (v as number) > 0 ? 1 / (2 * Math.PI * (v as number)) : 20000);
      },
      meter: flash.meter,
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node, smooth, range);
      },
    };
  },
});

export const controlModules = [envelope, lfo, keyboard, sequencer, arpeggiator, clock, random];
