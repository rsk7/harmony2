import { useRef } from "react";
import { defineModule, type Instance, type PanelProps } from "../audio/types";
import { disconnectAll, fmt, gain, glide, stopAll } from "../audio/util";
import { useAnimationFrame } from "../components/hooks";

// Wet/dry pair feeding one output. Returns a setter for the mix amount.
function wetDry(ctx: AudioContext, input: AudioNode, wetFrom: AudioNode, out: AudioNode, mix: number) {
  const dry = gain(ctx, 1 - mix);
  const wet = gain(ctx, mix);
  input.connect(dry).connect(out);
  wetFrom.connect(wet).connect(out);
  return {
    nodes: [dry, wet],
    set(v: number) {
      glide(dry.gain, 1 - v);
      glide(wet.gain, v);
    },
  };
}

const delay = defineModule({
  kind: "delay",
  title: "delay",
  category: "effects",
  description: "Echo with feedback and a darkening tone filter in the loop.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    time: { type: "knob", label: "time", min: 0.01, max: 2, default: 0.35, log: true, format: fmt.sec },
    feedback: { type: "knob", label: "fdbk", min: 0, max: 0.95, default: 0.4, format: fmt.pct },
    tone: { type: "knob", label: "tone", min: 300, max: 16000, default: 4000, log: true, format: fmt.hz },
    mix: { type: "knob", label: "mix", min: 0, max: 1, default: 0.35, format: fmt.pct },
  },
  compact: ["time", "mix"],
  create(ctx) {
    const input = gain(ctx);
    const out = gain(ctx);
    const d = ctx.createDelay(2.5);
    d.delayTime.value = 0.35;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 4000;
    const fb = gain(ctx, 0.4);
    input.connect(d).connect(tone).connect(fb).connect(d);
    const mix = wetDry(ctx, input, tone, out, 0.35);
    return {
      inputs: { in: input },
      outputs: { out },
      set(k, v) {
        const n = v as number;
        if (k === "time") glide(d.delayTime, n, 0.05);
        else if (k === "feedback") glide(fb.gain, n);
        else if (k === "tone") glide(tone.frequency, n);
        else if (k === "mix") mix.set(n);
      },
      dispose: () => disconnectAll(input, out, d, tone, fb, ...mix.nodes),
    };
  },
});

// Stereo exponentially-decaying noise: a cheap, decent room.
function impulse(ctx: BaseAudioContext, seconds: number, brightness: number) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    const k = 0.05 + brightness * 0.9;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - t, 3);
    }
  }
  return b;
}

const reverb = defineModule({
  kind: "reverb",
  title: "reverb",
  category: "effects",
  description: "Convolution reverb with a generated room.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    size: { type: "knob", label: "size", min: 0.2, max: 8, default: 2.5, log: true, format: fmt.sec },
    bright: { type: "knob", label: "bright", min: 0, max: 1, default: 0.5, format: fmt.pct },
    mix: { type: "knob", label: "mix", min: 0, max: 1, default: 0.3, format: fmt.pct },
  },
  compact: ["size", "mix"],
  create(ctx) {
    const input = gain(ctx);
    const out = gain(ctx);
    const conv = ctx.createConvolver();
    input.connect(conv);
    const mix = wetDry(ctx, input, conv, out, 0.3);
    let size = 2.5;
    let bright = 0.5;
    let timer = 0;
    // Regenerating the impulse is heavy-ish; wait for the knob to settle.
    const rebuild = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => (conv.buffer = impulse(ctx, size, bright)), 120);
    };
    conv.buffer = impulse(ctx, size, bright);
    return {
      inputs: { in: input },
      outputs: { out },
      set(k, v) {
        const n = v as number;
        if (k === "size") (size = n), rebuild();
        else if (k === "bright") (bright = n), rebuild();
        else if (k === "mix") mix.set(n);
      },
      dispose() {
        clearTimeout(timer);
        disconnectAll(input, out, conv, ...mix.nodes);
      },
    };
  },
});

const chorus = defineModule({
  kind: "chorus",
  title: "chorus",
  category: "effects",
  description: "Chorus or flanger: a short delay swept by an internal LFO.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    mode: {
      type: "choice",
      label: "mode",
      default: "chorus",
      options: [
        { value: "chorus", label: "chorus" },
        { value: "flanger", label: "flanger" },
      ],
    },
    rate: { type: "knob", label: "rate", min: 0.05, max: 8, default: 0.8, log: true, format: fmt.hz },
    depth: { type: "knob", label: "depth", min: 0, max: 1, default: 0.5, format: fmt.pct },
    feedback: { type: "knob", label: "fdbk", min: 0, max: 0.9, default: 0, format: fmt.pct },
    mix: { type: "knob", label: "mix", min: 0, max: 1, default: 0.5, format: fmt.pct },
  },
  compact: ["rate", "depth"],
  create(ctx) {
    const input = gain(ctx);
    const out = gain(ctx);
    const d = ctx.createDelay(0.1);
    const lfo = ctx.createOscillator();
    const depth = gain(ctx, 0);
    const fb = gain(ctx, 0);
    lfo.connect(depth).connect(d.delayTime);
    input.connect(d);
    d.connect(fb).connect(d);
    lfo.start();
    const mix = wetDry(ctx, input, d, out, 0.5);
    let mode = "chorus";
    let amount = 0.5;
    const apply = () => {
      // Chorus sits around 20 ms, flanger around 3 ms.
      const base = mode === "chorus" ? 0.02 : 0.003;
      const swing = mode === "chorus" ? 0.008 : 0.0028;
      glide(d.delayTime, base);
      glide(depth.gain, swing * amount);
    };
    apply();
    return {
      inputs: { in: input },
      outputs: { out },
      set(k, v) {
        if (k === "mode") mode = v as string;
        else if (k === "depth") amount = v as number;
        else if (k === "rate") glide(lfo.frequency, v as number);
        else if (k === "feedback") glide(fb.gain, v as number);
        else if (k === "mix") mix.set(v as number);
        apply();
      },
      dispose() {
        stopAll(lfo);
        disconnectAll(input, out, d, lfo, depth, fb, ...mix.nodes);
      },
    };
  },
});

type CompressorInstance = Instance & { reduction(): number };

function ReductionMeter({ instance }: PanelProps<CompressorInstance>) {
  const bar = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    const r = instance.reduction();
    if (bar.current) bar.current.style.width = `${Math.min(100, (-r / 30) * 100)}%`;
    if (label.current) label.current.textContent = `${r.toFixed(1)} dB`;
  });
  return (
    <div className="gr-meter" title="gain reduction">
      <div className="gr-track">
        <span ref={bar} />
      </div>
      <span ref={label} className="gr-label" />
    </div>
  );
}

const compressor = defineModule<CompressorInstance>({
  kind: "compressor",
  title: "compressor",
  category: "effects",
  description: "Evens out loud and quiet parts. Meter shows gain reduction.",
  width: 250,
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    threshold: { type: "knob", label: "thresh", min: -60, max: 0, default: -24, format: fmt.db },
    ratio: { type: "knob", label: "ratio", min: 1, max: 20, default: 4, log: true, format: fmt.ratio },
    attack: { type: "knob", label: "attack", min: 0.001, max: 0.5, default: 0.005, log: true, format: fmt.sec },
    release: { type: "knob", label: "release", min: 0.02, max: 1, default: 0.2, log: true, format: fmt.sec },
    makeup: { type: "knob", label: "makeup", min: 0, max: 24, default: 6, format: fmt.db },
  },
  compact: ["threshold"],
  Panel: ReductionMeter,
  create(ctx) {
    const comp = ctx.createDynamicsCompressor();
    const makeup = gain(ctx, 2);
    comp.connect(makeup);
    return {
      inputs: { in: comp },
      outputs: { out: makeup },
      reduction: () => comp.reduction,
      set(k, v) {
        const n = v as number;
        if (k === "threshold") glide(comp.threshold, n);
        else if (k === "ratio") glide(comp.ratio, n);
        else if (k === "attack") glide(comp.attack, n);
        else if (k === "release") glide(comp.release, n);
        else if (k === "makeup") glide(makeup.gain, Math.pow(10, n / 20));
      },
      meter: () => Math.min(1, -comp.reduction / 12),
      dispose: () => disconnectAll(comp, makeup),
    };
  },
});

export const effectModules = [delay, reverb, chorus, compressor];
