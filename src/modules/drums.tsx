import { defineModule, type Instance, type PanelProps } from "../audio/types";
import { disconnectAll, fmt, Store, worklet } from "../audio/util";
import { useStore } from "../components/hooks";

// ---- drum voices ----

type DrumInstance = Instance & { hit(): void };

function DrumPanel({ instance, compact }: PanelProps<DrumInstance>) {
  if (compact) return null;
  return (
    <button className="push nodrag" onPointerDown={() => instance.hit()}>
      hit
    </button>
  );
}

const VOICES: { kind: string; title: string; description: string; labels: [string, string, string] }[] = [
  { kind: "kick", title: "kick", description: "Bass drum: sine with a pitch drop.", labels: ["pitch", "decay", "click"] },
  { kind: "snare", title: "snare", description: "Tone body plus noise rattle.", labels: ["tone", "decay", "snap"] },
  { kind: "hat", title: "hi-hat", description: "Filtered noise. Short decay = closed, long = open.", labels: ["tone", "decay", "bite"] },
  { kind: "clap", title: "clap", description: "Burst of noise hits with a tail.", labels: ["tone", "decay", "snap"] },
  { kind: "tom", title: "tom", description: "Pitched drum with a short drop.", labels: ["pitch", "decay", "stick"] },
];

const DEFAULTS: Record<string, [number, number, number]> = {
  kick: [0.4, 0.4, 0.5],
  snare: [0.4, 0.4, 0.6],
  hat: [0.6, 0.15, 0.4],
  clap: [0.5, 0.35, 0.5],
  tom: [0.4, 0.4, 0.3],
};

const drumVoices = VOICES.map((v) => {
  const [tone, decay, snap] = DEFAULTS[v.kind];
  return defineModule<DrumInstance>({
    kind: v.kind,
    title: v.title,
    category: "drums",
    description: v.description + " Triggered by a gate or key.",
    inputs: [{ id: "trig", label: "trig" }],
    outputs: [{ id: "out", label: "out" }],
    params: {
      tone: { type: "knob", label: v.labels[0], min: 0, max: 1, default: tone, format: fmt.pct },
      decay: { type: "knob", label: v.labels[1], min: 0, max: 1, default: decay, format: fmt.pct },
      snap: { type: "knob", label: v.labels[2], min: 0, max: 1, default: snap, format: fmt.pct },
      level: { type: "knob", label: "level", min: 0, max: 1, default: 0.8, format: fmt.pct },
      key: { type: "key", label: "key", default: null },
    },
    compact: ["tone", "decay"],
    width: 230,
    Panel: DrumPanel,
    create(ctx) {
      const node = worklet(ctx, "drum-voice", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.postMessage({ voice: v.kind });
      let last = -1;
      node.port.onmessage = () => (last = performance.now());
      let key: string | null = null;
      const hit = () => node.port.postMessage({ hit: true });
      return {
        inputs: { trig: node },
        outputs: { out: node },
        hit,
        set(k, val) {
          if (k === "key") key = val as string | null;
          else node.port.postMessage({ params: { [k]: val } });
        },
        meter: () => (last < 0 ? 0 : Math.max(0, 1 - (performance.now() - last) / 150)),
        onKey(k, down) {
          if (k !== key) return false;
          if (down) hit();
          return true;
        },
        dispose() {
          node.port.onmessage = null;
          disconnectAll(node);
        },
      };
    },
  });
});

// ---- beat grid ----

const TRACKS = 4;
const GRID_STEPS = 16;
const DEFAULT_PATTERN = [
  "x...x...x...x...", // kick
  "....x.......x...", // snare
  "x.x.x.x.x.x.x.xx", // hat
  "............x..x", // clap
];

type GridInstance = Instance & { step: Store<number> };

function GridPanel({ instance, params, update, compact }: PanelProps<GridInstance>) {
  const current = useStore(instance.step);
  const length = Math.round(params.length as number);
  return (
    <div className={`grid nodrag${compact ? " compact" : ""}`}>
      {Array.from({ length: TRACKS }, (_, t) => {
        const row = (params[`t${t}`] as string).padEnd(GRID_STEPS, ".");
        return (
          <div key={t} className="grid-row">
            {Array.from({ length: GRID_STEPS }, (_, s) => (
              <button
                key={s}
                className={[
                  "grid-cell",
                  row[s] === "x" ? "on" : "",
                  s === current ? "current" : "",
                  s >= length ? "off-end" : "",
                  s % 4 === 0 ? "downbeat" : "",
                ].join(" ")}
                onClick={() => update({ [`t${t}`]: row.slice(0, s) + (row[s] === "x" ? "." : "x") + row.slice(s + 1) })}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

const beatGrid = defineModule<GridInstance>({
  kind: "beatgrid",
  title: "beat grid",
  category: "drums",
  description: "4 tracks × 16 steps of triggers. Clock in (use the 1/8 output for 16ths).",
  width: 400,
  compactWidth: 280,
  inputs: [
    { id: "clock", label: "clk" },
    { id: "reset", label: "rst" },
  ],
  outputs: Array.from({ length: TRACKS }, (_, i) => ({ id: `t${i}`, label: `${i + 1}` })),
  params: {
    ...Object.fromEntries(
      DEFAULT_PATTERN.map((p, i) => [`t${i}`, { type: "choice" as const, label: "", default: p, options: [], hidden: true }]),
    ),
    length: { type: "knob", label: "length", min: 1, max: GRID_STEPS, default: GRID_STEPS, step: 1, format: (v) => `${Math.round(v)} steps` },
  },
  compact: [],
  Panel: GridPanel,
  create(ctx) {
    const node = worklet(ctx, "trigger-grid", {
      numberOfInputs: 2,
      numberOfOutputs: TRACKS,
      outputChannelCount: new Array(TRACKS).fill(1),
    });
    const step = new Store(-1);
    let last = -1;
    node.port.onmessage = (e) => {
      step.set(e.data as number);
      last = performance.now();
    };
    const pattern = DEFAULT_PATTERN.map((p) => [...p].map((c) => c === "x"));
    return {
      inputs: { clock: [node, 0], reset: [node, 1] },
      outputs: Object.fromEntries(Array.from({ length: TRACKS }, (_, i) => [`t${i}`, [node, i] as [AudioNode, number]])),
      step,
      set(k, v) {
        const m = /^t(\d)$/.exec(k);
        if (m) {
          pattern[+m[1]] = [...(v as string)].map((c) => c === "x");
          node.port.postMessage({ pattern });
        } else if (k === "length") node.port.postMessage({ length: Math.round(v as number) });
      },
      meter: () => (last < 0 ? 0 : Math.max(0, 1 - (performance.now() - last) / 100)),
      dispose() {
        node.port.onmessage = null;
        disconnectAll(node);
      },
    };
  },
});

export const drumModules = [...drumVoices, beatGrid];
