import { defineModule } from "../audio/types";
import { disconnectAll, fmt, gain, glide } from "../audio/util";

const filter = defineModule({
  kind: "filter",
  title: "filter",
  category: "shaping",
  description: "Low/high/band-pass and notch. cutoff in: 1 unit = mod octaves.",
  inputs: [
    { id: "in", label: "in" },
    { id: "cutoff", label: "cut" },
  ],
  outputs: [{ id: "out", label: "out" }],
  params: {
    type: {
      type: "choice",
      label: "type",
      default: "lowpass",
      options: [
        { value: "lowpass", label: "LP" },
        { value: "highpass", label: "HP" },
        { value: "bandpass", label: "BP" },
        { value: "notch", label: "notch" },
      ],
    },
    cutoff: { type: "knob", label: "cutoff", min: 20, max: 18000, default: 1200, log: true, format: fmt.hz },
    q: { type: "knob", label: "reso", min: 0.1, max: 25, default: 1, log: true, format: (v) => v.toFixed(1) },
    mod: { type: "knob", label: "mod", min: 0, max: 6, default: 3, format: fmt.oct },
  },
  compact: ["cutoff", "q"],
  create(ctx) {
    const f = ctx.createBiquadFilter();
    f.frequency.value = 1200;
    // Cutoff CV drives detune, so modulation is in octaves; `mod` sets how many per unit.
    const cv = gain(ctx, 3 * 1200);
    cv.connect(f.detune);
    return {
      inputs: { in: f, cutoff: cv },
      outputs: { out: f },
      set(k, v) {
        if (k === "type") f.type = v as BiquadFilterType;
        else if (k === "cutoff") glide(f.frequency, v as number);
        else if (k === "q") glide(f.Q, v as number);
        else if (k === "mod") glide(cv.gain, (v as number) * 1200);
      },
      dispose: () => disconnectAll(f, cv),
    };
  },
});

const vca = defineModule({
  kind: "vca",
  title: "vca",
  category: "shaping",
  description: "Voltage-controlled amplifier: cv in opens it. Patch an envelope here.",
  inputs: [
    { id: "in", label: "in" },
    { id: "cv", label: "cv" },
  ],
  outputs: [{ id: "out", label: "out" }],
  params: {
    bias: { type: "knob", label: "bias", min: 0, max: 1, default: 0, format: fmt.pct },
    depth: { type: "knob", label: "cv amt", min: 0, max: 1, default: 1, format: fmt.pct },
  },
  compact: ["bias"],
  create(ctx) {
    const amp = gain(ctx, 0);
    const cv = gain(ctx, 1);
    cv.connect(amp.gain);
    return {
      inputs: { in: amp, cv },
      outputs: { out: amp },
      set(k, v) {
        if (k === "bias") glide(amp.gain, v as number);
        else if (k === "depth") glide(cv.gain, v as number);
      },
      meter: () => Math.min(1, amp.gain.value),
      dispose: () => disconnectAll(amp, cv),
    };
  },
});

const MIXER_CHANNELS = 4;

const mixer = defineModule({
  kind: "mixer",
  title: "mixer",
  category: "shaping",
  description: "Four inputs summed to one output.",
  width: 240,
  inputs: Array.from({ length: MIXER_CHANNELS }, (_, i) => ({ id: `in${i + 1}`, label: `${i + 1}` })),
  outputs: [{ id: "out", label: "out" }],
  params: {
    ...Object.fromEntries(
      Array.from({ length: MIXER_CHANNELS }, (_, i) => [
        `ch${i + 1}`,
        { type: "knob" as const, label: `ch ${i + 1}`, min: 0, max: 1, default: 0.8, format: fmt.pct },
      ]),
    ),
    master: { type: "knob", label: "master", min: 0, max: 1.5, default: 1, format: fmt.pct },
  },
  compact: ["master"],
  create(ctx) {
    const master = gain(ctx, 1);
    const channels = Array.from({ length: MIXER_CHANNELS }, () => {
      const g = gain(ctx, 0.8);
      g.connect(master);
      return g;
    });
    return {
      inputs: Object.fromEntries(channels.map((g, i) => [`in${i + 1}`, g])),
      outputs: { out: master },
      set(k, v) {
        if (k === "master") glide(master.gain, v as number);
        const ch = /^ch(\d)$/.exec(k);
        if (ch) glide(channels[+ch[1] - 1].gain, v as number);
      },
      dispose: () => disconnectAll(master, ...channels),
    };
  },
});

function shaperCurve(shape: string) {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] =
      shape === "hard"
        ? Math.max(-0.8, Math.min(0.8, x)) / 0.8
        : shape === "fold"
          ? Math.sin(x * Math.PI * 1.5)
          : shape === "bits"
            ? Math.round(x * 6) / 6
            : Math.tanh(x * 2.5) / Math.tanh(2.5);
  }
  return c;
}

const waveshaper = defineModule({
  kind: "waveshaper",
  title: "waveshaper",
  category: "shaping",
  description: "Distortion: soft saturation, hard clip, wavefolding or crush.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    shape: {
      type: "choice",
      label: "shape",
      default: "soft",
      options: [
        { value: "soft", label: "soft" },
        { value: "hard", label: "hard" },
        { value: "fold", label: "fold" },
        { value: "bits", label: "bits" },
      ],
    },
    drive: { type: "knob", label: "drive", min: 1, max: 40, default: 4, log: true, format: fmt.x },
    mix: { type: "knob", label: "mix", min: 0, max: 1, default: 1, format: fmt.pct },
    level: { type: "knob", label: "level", min: 0, max: 1, default: 0.5, format: fmt.pct },
  },
  compact: ["drive"],
  create(ctx) {
    const input = gain(ctx, 1);
    const drive = gain(ctx, 4);
    const shaper = ctx.createWaveShaper();
    shaper.oversample = "4x";
    const wet = gain(ctx, 1);
    const dry = gain(ctx, 0);
    const out = gain(ctx, 0.5);
    input.connect(drive).connect(shaper).connect(wet).connect(out);
    input.connect(dry).connect(out);
    return {
      inputs: { in: input },
      outputs: { out },
      set(k, v) {
        if (k === "shape") shaper.curve = shaperCurve(v as string);
        else if (k === "drive") glide(drive.gain, v as number);
        else if (k === "level") glide(out.gain, v as number);
        else if (k === "mix") {
          glide(wet.gain, v as number);
          glide(dry.gain, 1 - (v as number));
        }
      },
      dispose: () => disconnectAll(input, drive, shaper, wet, dry, out),
    };
  },
});

export const shapingModules = [filter, vca, mixer, waveshaper];
