import { useRef, useState } from "react";
import { defineModule, type Instance, type PanelProps } from "../audio/types";
import { constant, disconnectAll, fmt, gain, glide, rms, stopAll, Store, worklet } from "../audio/util";
import { useAnimationFrame, useStore } from "../components/hooks";

const multiple = defineModule({
  kind: "multiple",
  title: "multiple",
  category: "utility",
  description: "One signal copied to three outputs.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [
    { id: "o1", label: "1" },
    { id: "o2", label: "2" },
    { id: "o3", label: "3" },
  ],
  params: {},
  compact: [],
  width: 120,
  compactWidth: 120,
  create(ctx) {
    const input = gain(ctx);
    const outs = [gain(ctx), gain(ctx), gain(ctx)];
    outs.forEach((o) => input.connect(o));
    return {
      inputs: { in: input },
      outputs: { o1: outs[0], o2: outs[1], o3: outs[2] },
      dispose: () => disconnectAll(input, ...outs),
    };
  },
});

const attenuverter = defineModule({
  kind: "attenuverter",
  title: "attenuverter",
  category: "utility",
  description: "out = in × scale + offset. Scale below 0 flips the signal; with nothing in, it's a steady voltage.",
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "out", label: "out" }],
  params: {
    scale: { type: "knob", label: "scale", min: -2, max: 2, default: 1, format: fmt.signed },
    offset: { type: "knob", label: "offset", min: -2, max: 2, default: 0, format: fmt.signed },
  },
  compact: ["scale", "offset"],
  create(ctx) {
    const scale = gain(ctx, 1);
    const offset = constant(ctx, 0);
    const out = gain(ctx);
    scale.connect(out);
    offset.connect(out);
    return {
      inputs: { in: scale },
      outputs: { out },
      set(k, v) {
        if (k === "scale") glide(scale.gain, v as number);
        else if (k === "offset") glide(offset.offset, v as number);
      },
      dispose() {
        stopAll(offset);
        disconnectAll(scale, offset, out);
      },
    };
  },
});

// ---- recorder ----

type RecState = { recording: boolean; seconds: number; url: string | null };
type RecorderInstance = Instance & { state: Store<RecState>; toggle(): void };

function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number) {
  const frames = left.length;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + frames * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, frames * 4, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of [left, right]) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

function concat(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function RecorderPanel({ instance, compact }: PanelProps<RecorderInstance>) {
  const { recording, seconds, url } = useStore(instance.state);
  const [stamp] = useState(() => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"));
  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return (
    <div className="recorder nodrag">
      <button className={`rec${recording ? " on" : ""}`} onClick={() => instance.toggle()}>
        <span className="rec-dot" />
        {recording ? "stop" : "rec"}
      </button>
      <span className="rec-time">{time}</span>
      {url && !recording && !compact && (
        <a className="rec-download" href={url} download={`patchbay-${stamp}.wav`}>
          save .wav
        </a>
      )}
    </div>
  );
}

const recorder = defineModule<RecorderInstance>({
  kind: "recorder",
  title: "recorder",
  category: "utility",
  description: "Record what comes in to a .wav file. Passes audio through.",
  width: 220,
  inputs: [{ id: "in", label: "in" }],
  outputs: [{ id: "thru", label: "thru" }],
  params: {},
  compact: [],
  Panel: RecorderPanel,
  create(ctx) {
    const input = gain(ctx);
    const node = worklet(ctx, "recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: "explicit",
    });
    input.connect(node);
    const state = new Store<RecState>({ recording: false, seconds: 0, url: null });
    let left: Float32Array[] = [];
    let right: Float32Array[] = [];
    let frames = 0;
    node.port.onmessage = (e) => {
      const d = e.data as { left: Float32Array[]; right: Float32Array[] };
      left.push(...d.left);
      right.push(...d.right);
      frames += d.left.reduce((n, c) => n + c.length, 0);
      state.set({ ...state.get(), seconds: frames / ctx.sampleRate });
    };
    const finish = () => {
      const prev = state.get().url;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(encodeWav(concat(left), concat(right), ctx.sampleRate));
      state.set({ ...state.get(), url });
    };
    return {
      inputs: { in: input },
      outputs: { thru: input },
      state,
      toggle() {
        const s = state.get();
        if (s.recording) {
          state.set({ ...s, recording: false });
          node.port.postMessage({ record: false });
          // The worklet flushes its last chunk on stop; give it a moment to arrive.
          setTimeout(finish, 250);
        } else {
          left = [];
          right = [];
          frames = 0;
          state.set({ recording: true, seconds: 0, url: s.url });
          node.port.postMessage({ record: true });
        }
      },
      meter: () => (state.get().recording ? (Math.floor(performance.now() / 500) % 2 ? 1 : 0.3) : 0),
      dispose() {
        node.port.postMessage({ record: false });
        node.port.onmessage = null;
        const url = state.get().url;
        if (url) URL.revokeObjectURL(url);
        disconnectAll(input, node);
      },
    };
  },
});

// ---- speaker ----

type SpeakerInstance = Instance & { analyser: AnalyserNode };

function SpeakerPanel({ instance, compact }: PanelProps<SpeakerInstance>) {
  const cone = useRef<SVGGElement>(null);
  const smooth = useRef(0);
  const buf = useRef(new Float32Array(instance.analyser.fftSize));
  useAnimationFrame(() => {
    smooth.current = Math.max(rms(instance.analyser, buf.current), smooth.current * 0.9);
    const s = smooth.current;
    cone.current?.setAttribute("transform", `scale(${1 + Math.min(s, 0.5) * 0.4})`);
    cone.current?.parentElement?.classList.toggle("sounding", s > 0.002);
  });
  const size = compact ? 48 : 72;
  return (
    <svg className="cone" width={size} height={size} viewBox="-36 -36 72 72">
      <circle className="cone-rim" r="33" />
      <g ref={cone}>
        <circle className="cone-body" r="24" />
        <circle className="cone-cap" r="8" />
      </g>
    </svg>
  );
}

const speaker = defineModule<SpeakerInstance>({
  kind: "speaker",
  title: "speaker",
  category: "utility",
  description: "Your audio output. Patch here to hear things.",
  width: 160,
  compactWidth: 120,
  inputs: [{ id: "in", label: "in" }],
  outputs: [],
  params: {
    volume: { type: "knob", label: "volume", min: 0, max: 1, default: 0.5, format: fmt.pct },
  },
  compact: [],
  Panel: SpeakerPanel,
  create(ctx) {
    const volume = gain(ctx, 0.5);
    // A gentle limiter so stacking modules doesn't blast anyone's ears.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    volume.connect(limiter).connect(ctx.destination);
    limiter.connect(analyser);
    return {
      inputs: { in: volume },
      outputs: {},
      analyser,
      set(k, v) {
        if (k === "volume") glide(volume.gain, v as number);
      },
      dispose: () => disconnectAll(volume, limiter, analyser),
    };
  },
});

export const utilityModules = [speaker, multiple, attenuverter, recorder];
