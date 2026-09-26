import type { FC } from "react";

// Signal conventions (all signals are audio-rate):
//   audio  -1..1
//   pitch  1 unit per octave, 0 = C4 (261.63 Hz)
//   gate   0 = off, 1 = on (rising edge = trigger)
//   cv     roughly -1..1 (unipolar sources 0..1)

export type Port = { id: string; label: string };

export type KnobSpec = {
  type: "knob";
  label: string;
  min: number;
  max: number;
  default: number;
  log?: boolean;
  step?: number;
  format?: (v: number) => string;
  sub?: (v: number) => string;
};

export type ChoiceSpec = {
  type: "choice";
  label: string;
  default: string;
  options: { value: string; label: string; icon?: string }[];
};

export type ToggleSpec = { type: "toggle"; label: string; default: boolean };

// A bindable computer-keyboard key. `onBind` params are applied alongside the binding
// (e.g. an oscillator stops droning once it's played from a key).
export type KeySpec = { type: "key"; label: string; default: null; onBind?: Params };

// `hidden` params are stored and sent to the instance but drawn by a custom Panel.
export type ParamSpec = (KnobSpec | ChoiceSpec | ToggleSpec | KeySpec) & { hidden?: boolean };
export type ParamValue = number | string | boolean | null;
export type Params = Record<string, ParamValue>;

// Where a cable plugs in: a node input (optionally a numbered input), or an AudioParam.
export type InputEndpoint = AudioNode | AudioParam | [AudioNode, number];
// Where a cable comes from: a node output (optionally a numbered output).
export type OutputEndpoint = AudioNode | [AudioNode, number];

export interface Instance {
  inputs: Record<string, InputEndpoint>;
  outputs: Record<string, OutputEndpoint>;
  set?(key: string, value: ParamValue): void;
  // 0..1, polled every frame to light the module's LED.
  meter?(): number;
  // Return true if the key was used.
  onKey?(key: string, down: boolean): boolean;
  releaseKeys?(): void;
  dispose(): void;
}

export type PanelProps<I extends Instance = Instance> = {
  id: string;
  instance: I;
  params: Params;
  compact: boolean;
  color: string;
  update: (patch: Params) => void;
};

export type Category = "sources" | "shaping" | "control" | "drums" | "effects" | "visual" | "utility";

export type ModuleDef<I extends Instance = Instance> = {
  kind: string;
  title: string;
  category: Category;
  description: string;
  width?: number;
  compactWidth?: number;
  inputs: Port[];
  outputs: Port[];
  params: Record<string, ParamSpec>;
  // Params shown in the collapsed view.
  compact: string[];
  create(ctx: AudioContext): I;
  // Custom UI, drawn above the generic controls. Shown in both views; gets `compact`.
  Panel?: FC<PanelProps<I>>;
  // Custom UI drawn below the generic controls (expanded view only).
  Footer?: FC<PanelProps<I>>;
};

export function defineModule<I extends Instance>(def: ModuleDef<I>): ModuleDef {
  return def as unknown as ModuleDef;
}
