import type { Category, ModuleDef, Params } from "../audio/types";
import { controlModules } from "./control";
import { drumModules } from "./drums";
import { effectModules } from "./effects";
import { shapingModules } from "./shaping";
import { sourceModules } from "./sources";
import { utilityModules } from "./utility";
import { visualModules } from "./visual";

export const MODULES: ModuleDef[] = [
  ...sourceModules,
  ...shapingModules,
  ...controlModules,
  ...drumModules,
  ...effectModules,
  ...visualModules,
  ...utilityModules,
];

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "sources", label: "sources" },
  { id: "shaping", label: "shaping" },
  { id: "control", label: "control" },
  { id: "drums", label: "drums" },
  { id: "effects", label: "effects" },
  { id: "visual", label: "visual" },
  { id: "utility", label: "utility" },
];

// A pre-patched group of modules. Positions are relative; `output` is auto-patched
// into the first speaker on the page, if there is one.
export type Preset = {
  id: string;
  title: string;
  description: string;
  modules: { kind: string; x: number; y: number; params?: Params; collapsed?: boolean }[];
  cables: [from: number, fromPort: string, to: number, toPort: string][];
  output?: [module: number, port: string];
};

export const PRESETS: Preset[] = [
  {
    id: "drum-kit",
    title: "drum kit",
    description: "Clock → beat grid → kick, snare, hat, clap → mixer.",
    modules: [
      { kind: "clock", x: 0, y: 0 },
      { kind: "beatgrid", x: 280, y: 0 },
      { kind: "kick", x: 760, y: -120, collapsed: true },
      { kind: "snare", x: 760, y: 50, collapsed: true },
      { kind: "hat", x: 760, y: 220, collapsed: true },
      { kind: "clap", x: 760, y: 390, collapsed: true },
      { kind: "mixer", x: 1080, y: 60 },
    ],
    cables: [
      [0, "x2", 1, "clock"],
      [1, "t0", 2, "trig"],
      [1, "t1", 3, "trig"],
      [1, "t2", 4, "trig"],
      [1, "t3", 5, "trig"],
      [2, "out", 6, "in1"],
      [3, "out", 6, "in2"],
      [4, "out", 6, "in3"],
      [5, "out", 6, "in4"],
    ],
    output: [6, "out"],
  },
  {
    id: "synth-voice",
    title: "synth voice",
    description: "Keyboard → oscillator → filter → vca, with an envelope on the vca and filter.",
    modules: [
      { kind: "keyboard", x: 0, y: 40 },
      { kind: "oscillator", x: 380, y: -40, params: { wave: "sawtooth", on: true } },
      { kind: "filter", x: 650, y: -40, params: { cutoff: 600, q: 4, mod: 3 } },
      { kind: "envelope", x: 380, y: 300 },
      { kind: "vca", x: 930, y: 40 },
    ],
    cables: [
      [0, "pitch", 1, "pitch"],
      [0, "gate", 3, "gate"],
      [1, "out", 2, "in"],
      [2, "out", 4, "in"],
      [3, "out", 4, "cv"],
      [3, "out", 2, "cutoff"],
    ],
    output: [4, "out"],
  },
  {
    id: "arp-voice",
    title: "arp voice",
    description: "Hold a key: keyboard + clock → arpeggiator → oscillator → envelope/vca → delay.",
    modules: [
      { kind: "keyboard", x: 0, y: 160 },
      { kind: "clock", x: 0, y: -120, params: { bpm: 140 } },
      { kind: "arpeggiator", x: 380, y: 0 },
      { kind: "oscillator", x: 680, y: -60, params: { wave: "triangle", on: true } },
      { kind: "envelope", x: 680, y: 300, params: { attack: 0.003, decay: 0.15, sustain: 0.2, release: 0.2 } },
      { kind: "vca", x: 980, y: 0 },
      { kind: "delay", x: 1220, y: 0, params: { time: 0.32, mix: 0.3 } },
    ],
    cables: [
      [1, "x2", 2, "clock"],
      [0, "pitch", 2, "pitch"],
      [0, "gate", 2, "gate"],
      [2, "pitch", 3, "pitch"],
      [2, "gate", 4, "gate"],
      [3, "out", 5, "in"],
      [4, "out", 5, "cv"],
      [5, "out", 6, "in"],
    ],
    output: [6, "out"],
  },
];
