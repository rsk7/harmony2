// Framework-free audio graph. UI state (React Flow nodes/edges) is reconciled into it.

import processorsUrl from "./worklets/processors.ts?worker&url";
import type { InputEndpoint, Instance, ModuleDef, OutputEndpoint } from "./types";

let ctx: AudioContext | null = null;
let ready: Promise<void> | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  return ctx;
}

// Load worklet processors. Must finish before any module is created.
export function initAudio() {
  ready ??= audioContext().audioWorklet.addModule(processorsUrl);
  return ready;
}

// Browsers keep the context suspended until a user gesture.
export function resumeAudio() {
  const c = audioContext();
  if (c.state === "suspended") void c.resume();
}

const registry = new Map<string, ModuleDef>();

export function registerModules(defs: ModuleDef[]) {
  for (const d of defs) registry.set(d.kind, d);
}

export function moduleDef(kind: string) {
  return registry.get(kind);
}

export function allModuleDefs() {
  return [...registry.values()];
}

const instances = new Map<string, Instance>();

type Wire = { source: string; sourceHandle: string; target: string; targetHandle: string };
const wires = new Map<string, Wire>();

export function ensureInstance<I extends Instance = Instance>(id: string, kind: string): I {
  let inst = instances.get(id);
  if (!inst) {
    const def = registry.get(kind);
    if (!def) throw new Error(`unknown module kind: ${kind}`);
    inst = def.create(audioContext());
    instances.set(id, inst);
  }
  return inst as I;
}

export function getInstance(id: string) {
  return instances.get(id);
}

export function allInstances() {
  return instances.values();
}

function endpoints(w: Wire) {
  const out = instances.get(w.source)?.outputs[w.sourceHandle];
  const inp = instances.get(w.target)?.inputs[w.targetHandle];
  return out && inp ? { out, inp } : null;
}

function wire(out: OutputEndpoint, inp: InputEndpoint, connect: boolean) {
  const [src, outIdx] = Array.isArray(out) ? out : [out, 0];
  try {
    if (inp instanceof AudioParam) {
      if (connect) src.connect(inp, outIdx);
      else src.disconnect(inp, outIdx);
    } else {
      const [dst, inIdx] = Array.isArray(inp) ? inp : [inp, 0];
      if (connect) src.connect(dst, outIdx, inIdx);
      else src.disconnect(dst, outIdx, inIdx);
    }
  } catch {
    // disconnecting something already gone
  }
}

type EdgeLike = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

// Make the audio graph match the given nodes and edges. Idempotent.
export function reconcile(nodes: { id: string; type?: string }[], edges: EdgeLike[]) {
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.type && registry.has(n.type)) ensureInstance(n.id, n.type);

  const wanted = new Map<string, Wire>();
  for (const e of edges) {
    if (e.sourceHandle && e.targetHandle) {
      wanted.set(e.id, { source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle });
    }
  }

  for (const [id, w] of wires) {
    const next = wanted.get(id);
    if (!next || JSON.stringify(next) !== JSON.stringify(w)) {
      const ep = endpoints(w);
      if (ep) wire(ep.out, ep.inp, false);
      wires.delete(id);
    }
  }

  for (const [id, inst] of instances) {
    if (!nodeIds.has(id)) {
      inst.dispose();
      instances.delete(id);
    }
  }

  for (const [id, w] of wanted) {
    if (wires.has(id)) continue;
    const ep = endpoints(w);
    if (ep) {
      wire(ep.out, ep.inp, true);
      wires.set(id, w);
    }
  }
}
