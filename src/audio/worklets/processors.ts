// AudioWorklet processors for modules that react to gates/clocks sample-accurately.
// Runs in AudioWorkletGlobalScope, so declare the few globals we use.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type Inputs = Float32Array[][];
type ParamValues = Record<string, Float32Array>;

const HIGH = 0.5; // gate/clock threshold
const REPORT_EVERY = Math.round(sampleRate / 30); // ~30 UI updates per second

const connected = (input: Float32Array[] | undefined) => !!input && input.length > 0;

class Envelope extends AudioWorkletProcessor {
  static parameterDescriptors = [
    { name: "attack", defaultValue: 0.01, minValue: 0.001, maxValue: 10, automationRate: "k-rate" },
    { name: "decay", defaultValue: 0.2, minValue: 0.001, maxValue: 10, automationRate: "k-rate" },
    { name: "sustain", defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    { name: "release", defaultValue: 0.4, minValue: 0.001, maxValue: 10, automationRate: "k-rate" },
  ];
  private stage: "idle" | "attack" | "decay" | "sustain" | "release" = "idle";
  private level = 0;
  private prevGate = false;
  private manual = false;
  private sinceReport = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => (this.manual = !!e.data.gate);
  }

  process(inputs: Inputs, outputs: Inputs, p: ParamValues) {
    const out = outputs[0][0];
    const gateIn = inputs[0][0];
    const attackStep = 1 / (p.attack[0] * sampleRate);
    // Exponential segments reach ~98% of their target in the set time.
    const decayCoef = Math.exp(-4 / (p.decay[0] * sampleRate));
    const releaseCoef = Math.exp(-4 / (p.release[0] * sampleRate));
    const sustain = p.sustain[0];

    for (let i = 0; i < out.length; i++) {
      const gate = this.manual || (!!gateIn && gateIn[i] > HIGH);
      if (gate && !this.prevGate) this.stage = "attack";
      else if (!gate && this.prevGate) this.stage = "release";
      this.prevGate = gate;

      switch (this.stage) {
        case "attack":
          this.level += attackStep;
          if (this.level >= 1) {
            this.level = 1;
            this.stage = "decay";
          }
          break;
        case "decay":
          this.level = sustain + (this.level - sustain) * decayCoef;
          if (Math.abs(this.level - sustain) < 1e-4) this.stage = "sustain";
          break;
        case "sustain":
          this.level = sustain;
          break;
        case "release":
          this.level *= releaseCoef;
          if (this.level < 1e-5) {
            this.level = 0;
            this.stage = "idle";
          }
          break;
      }
      out[i] = this.level;
    }

    this.sinceReport += out.length;
    if (this.sinceReport >= REPORT_EVERY) {
      this.sinceReport = 0;
      this.port.postMessage(this.level);
    }
    return true;
  }
}

// Square pulses (50% duty) at the beat, twice the beat, half and quarter.
class Clock extends AudioWorkletProcessor {
  static parameterDescriptors = [{ name: "bpm", defaultValue: 120, minValue: 1, maxValue: 999, automationRate: "k-rate" }];
  private phase = 0; // in beats, wraps every 4 beats
  private running = true;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.run !== undefined) {
        this.running = !!e.data.run;
        this.phase = 0;
      }
    };
  }

  process(_inputs: Inputs, outputs: Inputs, p: ParamValues) {
    const inc = p.bpm[0] / 60 / sampleRate;
    const [x1, x2, d2, d4] = outputs.map((o) => o[0]);
    const n = x1.length;
    for (let i = 0; i < n; i++) {
      if (!this.running) {
        x1[i] = x2[i] = d2[i] = d4[i] = 0;
        continue;
      }
      const beat = this.phase;
      x1[i] = beat % 1 < 0.5 ? 1 : 0;
      x2[i] = (beat * 2) % 1 < 0.5 ? 1 : 0;
      d2[i] = (beat / 2) % 1 < 0.5 ? 1 : 0;
      d4[i] = (beat / 4) % 1 < 0.5 ? 1 : 0;
      const next = beat + inc;
      if (Math.floor(next) !== Math.floor(beat)) this.port.postMessage(Math.floor(next) % 4);
      this.phase = next % 4;
    }
    return true;
  }
}

// Steps through up to 16 steps on each rising clock edge.
// Outputs pitch (semitones / 12) and a gate that follows the clock on active steps.
class Sequencer extends AudioWorkletProcessor {
  private steps: number[] = new Array(16).fill(0);
  private gates: boolean[] = new Array(16).fill(true);
  private length = 8;
  private index = -1;
  private prevClock = false;
  private prevReset = false;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.steps) this.steps = d.steps;
      if (d.gates) this.gates = d.gates;
      if (d.length) this.length = d.length;
    };
  }

  process(inputs: Inputs, outputs: Inputs) {
    const clock = inputs[0][0];
    const reset = inputs[1][0];
    const pitch = outputs[0][0];
    const gate = outputs[1][0];
    for (let i = 0; i < pitch.length; i++) {
      const r = !!reset && reset[i] > HIGH;
      if (r && !this.prevReset) {
        this.index = -1;
        this.port.postMessage(-1);
      }
      this.prevReset = r;

      const c = !!clock && clock[i] > HIGH;
      if (c && !this.prevClock) {
        this.index = (this.index + 1) % this.length;
        this.port.postMessage(this.index);
      }
      this.prevClock = c;

      const s = Math.max(0, this.index);
      pitch[i] = this.steps[s] / 12;
      gate[i] = c && this.index >= 0 && this.gates[s] ? 1 : 0;
    }
    return true;
  }
}

// Plays a chord built on the incoming root pitch, one note per rising clock edge,
// while the incoming gate is high (or always, if latched / nothing is patched in).
class Arpeggiator extends AudioWorkletProcessor {
  private chord = [0, 4, 7];
  private octaves = 1;
  private pattern = "up";
  private latch = false;
  private sequence: number[] = [];
  private index = -1;
  private current = 0;
  private prevClock = false;
  private held = false;

  constructor() {
    super();
    this.build();
    this.port.onmessage = (e) => {
      Object.assign(this, e.data);
      if (!this.latch) this.held = false;
      this.build();
    };
  }

  private build() {
    const up: number[] = [];
    for (let o = 0; o < this.octaves; o++) for (const s of this.chord) up.push(s + 12 * o);
    if (this.pattern === "down") this.sequence = [...up].reverse();
    else if (this.pattern === "updown") this.sequence = up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    else this.sequence = up;
    this.index = Math.min(this.index, this.sequence.length - 1);
  }

  process(inputs: Inputs, outputs: Inputs) {
    const clock = inputs[0][0];
    const root = inputs[1][0];
    const gateInput = inputs[2];
    const pitch = outputs[0][0];
    const gate = outputs[1][0];
    for (let i = 0; i < pitch.length; i++) {
      // Latch keeps the arp running after the gate drops, once it has been opened.
      const gateOn = !connected(gateInput) || gateInput[0][i] > HIGH;
      if (gateOn) this.held = true;
      const playing = gateOn || (this.latch && this.held);

      if (!playing) this.index = -1;
      const c = !!clock && clock[i] > HIGH;
      if (c && !this.prevClock && playing) {
        this.index =
          this.pattern === "random"
            ? Math.floor(Math.random() * this.sequence.length)
            : (this.index + 1) % this.sequence.length;
        this.current = this.sequence[this.index];
        this.port.postMessage(this.index);
      }
      this.prevClock = c;

      pitch[i] = (root ? root[i] : 0) + this.current / 12;
      gate[i] = c && playing && this.index >= 0 ? 1 : 0;
    }
    return true;
  }

}

// On each rising trigger edge, sample the input (or white noise if nothing is patched).
class SampleHold extends AudioWorkletProcessor {
  private value = 0;
  private prev = false;

  process(inputs: Inputs, outputs: Inputs) {
    const trig = inputs[0][0];
    const input = inputs[1];
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      const t = !!trig && trig[i] > HIGH;
      if (t && !this.prev) {
        this.value = connected(input) ? input[0][i] : Math.random() * 2 - 1;
        this.port.postMessage(this.value);
      }
      this.prev = t;
      out[i] = this.value;
    }
    return true;
  }
}

// Reports gate edges to the main thread (true = rising, false = falling).
class GateWatch extends AudioWorkletProcessor {
  private prev = false;

  process(inputs: Inputs) {
    const g = inputs[0][0];
    if (!g) return true;
    for (let i = 0; i < g.length; i++) {
      const on = g[i] > HIGH;
      if (on !== this.prev) this.port.postMessage(on);
      this.prev = on;
    }
    return true;
  }
}

// Streams stereo input to the main thread while recording, in ~0.1s chunks.
class Recorder extends AudioWorkletProcessor {
  private recording = false;
  private left: Float32Array[] = [];
  private right: Float32Array[] = [];
  private frames = 0;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      this.recording = !!e.data.record;
      if (!this.recording) this.flush();
    };
  }

  private flush() {
    if (!this.frames) return;
    this.port.postMessage({ left: this.left, right: this.right });
    this.left = [];
    this.right = [];
    this.frames = 0;
  }

  process(inputs: Inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    const n = input[0]?.length ?? 128;
    const l = input[0] ? input[0].slice() : new Float32Array(n);
    const r = input[1] ? input[1].slice() : l.slice();
    this.left.push(l);
    this.right.push(r);
    this.frames += n;
    if (this.frames >= sampleRate / 10) this.flush();
    return true;
  }
}

// ---- drums ----

// Minimal state-variable filter (Chamberlin), enough for drum noise shaping.
class SVF {
  low = 0;
  band = 0;
  high = 0;
  process(x: number, cutoff: number, q: number) {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, sampleRate / 6)) / sampleRate);
    this.low += f * this.band;
    this.high = x - this.low - q * this.band;
    this.band += f * this.high;
    return this;
  }
}

type DrumParams = { tone: number; decay: number; snap: number; level: number };

// Synthesizes one drum voice, retriggered on each rising edge of its trigger input.
// tone/decay/snap are 0..1 and mean slightly different things per voice.
class DrumVoice extends AudioWorkletProcessor {
  private voice = "kick";
  private p: DrumParams = { tone: 0.5, decay: 0.5, snap: 0.5, level: 0.8 };
  private t = -1; // seconds since trigger, -1 = silent
  private phase = 0;
  private prev = false;
  private svf = new SVF();
  private svf2 = new SVF();
  private velocity = 1;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.voice) this.voice = e.data.voice;
      if (e.data.params) this.p = { ...this.p, ...e.data.params };
      if (e.data.hit) this.trigger(1);
    };
  }

  private trigger(velocity: number) {
    this.t = 0;
    this.phase = 0;
    this.velocity = velocity;
    this.port.postMessage("hit");
  }

  process(inputs: Inputs, outputs: Inputs) {
    const trig = inputs[0][0];
    const out = outputs[0][0];
    const dt = 1 / sampleRate;
    for (let i = 0; i < out.length; i++) {
      const on = !!trig && trig[i] > HIGH;
      if (on && !this.prev) this.trigger(Math.min(1, trig[i]));
      this.prev = on;
      out[i] = this.t < 0 ? 0 : this.sample() * this.p.level * this.velocity;
      if (this.t >= 0) {
        this.t += dt;
        if (this.t > 3) this.t = -1;
      }
    }
    return true;
  }

  private noise() {
    return Math.random() * 2 - 1;
  }

  private osc(freq: number) {
    this.phase += freq / sampleRate;
    return Math.sin(2 * Math.PI * this.phase);
  }

  private sample() {
    const { tone, decay, snap } = this.p;
    const t = this.t;
    switch (this.voice) {
      case "kick": {
        // Sine with a fast downward pitch sweep plus a click.
        const base = 40 + tone * 50;
        const freq = base + base * 3 * Math.exp(-t / (0.01 + snap * 0.04));
        const amp = Math.exp(-t / (0.08 + decay * 0.6));
        const click = t < 0.003 ? this.noise() * 0.4 * snap : 0;
        return Math.tanh(this.osc(freq) * amp * 1.6 + click);
      }
      case "snare": {
        // Pitched body + high-passed noise, snap balances the two.
        const body = this.osc(160 + tone * 120) * Math.exp(-t / 0.05);
        const n = this.svf.process(this.noise(), 1800 + tone * 4000, 0.9).high;
        const rattle = n * Math.exp(-t / (0.06 + decay * 0.3));
        return body * (1 - snap * 0.6) + rattle * (0.4 + snap * 0.8);
      }
      case "hat": {
        // Metallic-ish noise: band-passed, then high-passed. Short decay = closed hat.
        const x = this.noise();
        const b = this.svf.process(x, 7000 + tone * 5000, 0.4).band;
        const h = this.svf2.process(b, 6000 + tone * 3000, 0.7).high;
        return h * Math.exp(-t / (0.015 + decay * decay * 0.5)) * (1.5 + snap);
      }
      case "clap": {
        // Three quick noise bursts then a tail, band-passed.
        const bursts = [0, 0.011, 0.023];
        let env = 0;
        for (const b of bursts) if (t >= b) env = Math.max(env, Math.exp(-(t - b) / 0.004));
        const tail = t >= 0.023 ? Math.exp(-(t - 0.023) / (0.05 + decay * 0.4)) * 0.7 : 0;
        const x = this.svf.process(this.noise(), 900 + tone * 1800, 0.5 - snap * 0.3).band;
        return x * Math.max(env, tail) * 2.2;
      }
      case "tom": {
        const base = 80 + tone * 180;
        const freq = base * (1 + 0.6 * Math.exp(-t / 0.03));
        const amp = Math.exp(-t / (0.1 + decay * 0.6));
        return this.osc(freq) * amp + this.noise() * 0.15 * snap * Math.exp(-t / 0.01);
      }
    }
    return 0;
  }
}

// Up to 16 steps × 4 tracks of triggers. On each rising clock edge, every track whose
// current step is on outputs a gate for as long as the clock stays high.
class TriggerGrid extends AudioWorkletProcessor {
  private pattern: boolean[][] = [[], [], [], []];
  private length = 16;
  private index = -1;
  private prevClock = false;
  private prevReset = false;

  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data.pattern) this.pattern = e.data.pattern;
      if (e.data.length) this.length = e.data.length;
    };
  }

  process(inputs: Inputs, outputs: Inputs) {
    const clock = inputs[0][0];
    const reset = inputs[1][0];
    const outs = outputs.map((o) => o[0]);
    for (let i = 0; i < outs[0].length; i++) {
      const r = !!reset && reset[i] > HIGH;
      if (r && !this.prevReset) this.index = -1;
      this.prevReset = r;

      const c = !!clock && clock[i] > HIGH;
      if (c && !this.prevClock) {
        this.index = (this.index + 1) % this.length;
        this.port.postMessage(this.index);
      }
      this.prevClock = c;
      for (let tr = 0; tr < outs.length; tr++) {
        outs[tr][i] = c && this.index >= 0 && this.pattern[tr]?.[this.index] ? 1 : 0;
      }
    }
    return true;
  }
}

registerProcessor("drum-voice", DrumVoice);
registerProcessor("trigger-grid", TriggerGrid);
registerProcessor("envelope", Envelope);
registerProcessor("clock", Clock);
registerProcessor("sequencer", Sequencer);
registerProcessor("arpeggiator", Arpeggiator);
registerProcessor("sample-hold", SampleHold);
registerProcessor("gate-watch", GateWatch);
registerProcessor("recorder", Recorder);
