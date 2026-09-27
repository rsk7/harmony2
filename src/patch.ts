// Patch data: building nodes, custom components (groups of modules), flattening them
// for the audio engine, (de)serializing patches, and the localStorage stores.

import type { Node } from "@xyflow/react";
import { moduleDef } from "./audio/engine";
import type { Params } from "./audio/types";
import { defaultParams, type ModuleData, type ModuleFlowNode } from "./components/ModuleNode";
import type { CableEdge } from "./components/PatchCable";

// ---- nodes ----

// Saturated picks in the spirit of harmony's random key colors, all readable on white.
export const COLORS = [
  "#FF6347", "#1E90FF", "#FFB300", "#32CD32", "#FF1493", "#9370DB",
  "#20B2AA", "#FF8C00", "#DC143C", "#00BFFF", "#8A2BE2", "#3CB371",
];
export const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
export const newId = () => crypto.randomUUID().slice(0, 8);

export const COMPONENT = "component";

// A jack on a custom component, standing in for one jack of a module inside it.
export type ComponentPort = { id: string; label: string; dir: "in" | "out"; node: string; handle: string };

export type InnerModule = { id: string; type: string; position: { x: number; y: number }; data: ModuleData };
export type InnerCable = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string };

export type ComponentData = {
  name: string;
  color: string;
  collapsed?: boolean;
  modules: InnerModule[];
  cables: InnerCable[];
  ports: ComponentPort[];
  // Inner modules whose (compact) controls appear on the component's panel.
  shown: string[];
};
export type ComponentFlowNode = Node<ComponentData, typeof COMPONENT>;

export type PatchNode = ModuleFlowNode | ComponentFlowNode;
export const isComponent = (n: PatchNode): n is ComponentFlowNode => n.type === COMPONENT;

export function makeNode(
  kind: string,
  x: number,
  y: number,
  extra: { params?: Params; collapsed?: boolean; color?: string } = {},
): ModuleFlowNode {
  const def = moduleDef(kind)!;
  return {
    id: newId(),
    type: kind,
    position: { x, y },
    data: {
      color: extra.color ?? randomColor(),
      collapsed: extra.collapsed,
      params: { ...defaultParams(def), ...extra.params },
    },
  };
}

export function cable(source: PatchNode, sourceHandle: string, target: PatchNode, targetHandle: string): CableEdge {
  return {
    id: newId(),
    type: "cable",
    source: source.id,
    sourceHandle,
    target: target.id,
    targetHandle,
    data: { color: source.data.color },
  };
}

// ---- layouts (presets & setups) ----

// A compact description of a patch: modules at positions, and cables between them by
// index. Used for the built-in presets and setups.
export type Layout = {
  modules: { kind: string; x: number; y: number; params?: Params; collapsed?: boolean }[];
  cables: [from: number, fromPort: string, to: number, toPort: string][];
};

export function buildLayout(layout: Layout, origin = { x: 0, y: 0 }) {
  const nodes = layout.modules.map((m) =>
    makeNode(m.kind, origin.x + m.x, origin.y + m.y, { params: m.params, collapsed: m.collapsed }),
  );
  const edges = layout.cables.map(([from, fp, to, tp]) => cable(nodes[from], fp, nodes[to], tp));
  return { nodes, edges };
}

// ---- flattening components for the audio engine ----

type FlatNode = { id: string; type: string };
type FlatEdge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string };

export const innerId = (componentId: string, moduleId: string) => `${componentId}/${moduleId}`;

// Replace every component with the modules inside it, and re-route cables plugged into
// a component's jacks to the inner module jacks they stand for.
export function flatten(nodes: PatchNode[], edges: CableEdge[]) {
  const flatNodes: FlatNode[] = [];
  const flatEdges: FlatEdge[] = [];
  const components = new Map<string, ComponentData>();

  for (const n of nodes) {
    if (isComponent(n)) {
      components.set(n.id, n.data);
      for (const m of n.data.modules) flatNodes.push({ id: innerId(n.id, m.id), type: m.type });
      for (const c of n.data.cables) {
        flatEdges.push({
          id: innerId(n.id, c.id),
          source: innerId(n.id, c.source),
          sourceHandle: c.sourceHandle,
          target: innerId(n.id, c.target),
          targetHandle: c.targetHandle,
        });
      }
    } else if (n.type) flatNodes.push({ id: n.id, type: n.type });
  }

  const resolve = (nodeId: string, handle: string | null | undefined) => {
    const comp = components.get(nodeId);
    if (!comp) return handle ? { id: nodeId, handle } : null;
    const port = comp.ports.find((p) => p.id === handle);
    return port ? { id: innerId(nodeId, port.node), handle: port.handle } : null;
  };
  for (const e of edges) {
    const s = resolve(e.source, e.sourceHandle);
    const t = resolve(e.target, e.targetHandle);
    if (s && t) flatEdges.push({ id: e.id, source: s.id, sourceHandle: s.handle, target: t.id, targetHandle: t.handle });
  }
  return { nodes: flatNodes, edges: flatEdges };
}

// ---- grouping ----

export type PortCandidate = ComponentPort & { module: string; boundary: boolean; internal: boolean };

// Module titles for a selection, numbered when a kind repeats ("oscillator 1", "oscillator 2").
export function numberedTitles(nodes: PatchNode[], ids: Set<string>) {
  const members = nodes.filter((n) => ids.has(n.id) && !isComponent(n));
  const title = (n: PatchNode) => moduleDef(n.type!)?.title ?? n.type!;
  const totals = new Map<string, number>();
  for (const n of members) totals.set(title(n), (totals.get(title(n)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    members.map((n) => {
      const t = title(n);
      const i = (seen.get(t) ?? 0) + 1;
      seen.set(t, i);
      return [n.id, totals.get(t)! > 1 ? `${t} ${i}` : t];
    }),
  );
}

// Every jack on the selected modules that could become a jack on the new component.
// `boundary`: a cable crosses the selection edge here. `internal`: cabled inside it.
export function portCandidates(nodes: PatchNode[], edges: CableEdge[], selected: Set<string>): PortCandidate[] {
  const out: PortCandidate[] = [];
  const titles = numberedTitles(nodes, selected);
  for (const n of nodes) {
    if (!selected.has(n.id) || isComponent(n)) continue;
    const def = moduleDef(n.type!)!;
    const add = (dir: "in" | "out", handle: string, label: string) => {
      const mine = edges.filter((e) =>
        dir === "out" ? e.source === n.id && e.sourceHandle === handle : e.target === n.id && e.targetHandle === handle,
      );
      const other = (e: CableEdge) => (dir === "out" ? e.target : e.source);
      out.push({
        id: `${n.id}:${handle}`,
        label,
        dir,
        node: n.id,
        handle,
        module: titles.get(n.id)!,
        boundary: mine.some((e) => !selected.has(other(e))),
        internal: mine.some((e) => selected.has(other(e))),
      });
    };
    def.inputs.forEach((p) => add("in", p.id, p.label));
    def.outputs.forEach((p) => add("out", p.id, p.label));
  }
  return out;
}

// Short jack labels: just the port name when that's unambiguous, else numbered
// ("pitch 1", "pitch 2") in the order the dialog lists them.
function labelPorts(ports: PortCandidate[]): ComponentPort[] {
  const seen = new Map<string, number>();
  return ports.map((p) => {
    const key = `${p.dir}:${p.label}`;
    const clash = ports.some((q) => q !== p && q.dir === p.dir && q.label === p.label);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { id: p.id, dir: p.dir, node: p.node, handle: p.handle, label: clash ? `${p.label} ${n}` : p.label };
  });
}

// Replace the selected modules with one component. Cables crossing the selection edge
// are re-plugged into the component's matching jacks (or dropped if that jack wasn't
// exposed); cables inside the selection move inside the component.
export function groupModules(
  nodes: PatchNode[],
  edges: CableEdge[],
  selected: Set<string>,
  opts: { name: string; ports: PortCandidate[]; shown: string[] },
) {
  const members = nodes.filter((n) => selected.has(n.id)) as ModuleFlowNode[];
  const minX = Math.min(...members.map((n) => n.position.x));
  const minY = Math.min(...members.map((n) => n.position.y));
  const ports = labelPorts(opts.ports);
  const portFor = (node: string, handle: string) => ports.find((p) => p.node === node && p.handle === handle);

  const data: ComponentData = {
    name: opts.name,
    color: randomColor(),
    modules: members.map((n) => ({
      id: n.id,
      type: n.type!,
      position: { x: n.position.x - minX, y: n.position.y - minY },
      data: { ...n.data, collapsed: true },
    })),
    cables: edges
      .filter((e) => selected.has(e.source) && selected.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle!, target: e.target, targetHandle: e.targetHandle! })),
    ports,
    shown: opts.shown,
  };
  const component: ComponentFlowNode = { id: newId(), type: COMPONENT, position: { x: minX, y: minY }, data, selected: true };

  const nextEdges: CableEdge[] = [];
  for (const e of edges) {
    const s = selected.has(e.source);
    const t = selected.has(e.target);
    if (s && t) continue; // moved inside
    if (!s && !t) {
      nextEdges.push(e);
      continue;
    }
    const port = s ? portFor(e.source, e.sourceHandle!) : portFor(e.target, e.targetHandle!);
    if (!port) continue; // jack not exposed: the cable is unplugged
    nextEdges.push(
      s
        ? { ...e, source: component.id, sourceHandle: port.id, data: { color: data.color } }
        : { ...e, target: component.id, targetHandle: port.id },
    );
  }
  return { nodes: [...nodes.filter((n) => !selected.has(n.id)), component], edges: nextEdges, component };
}

// Break a component back into its modules, with fresh ids so several copies of the
// same component can be ungrouped side by side.
export function ungroup(nodes: PatchNode[], edges: CableEdge[], componentId: string) {
  const comp = nodes.find((n) => n.id === componentId);
  if (!comp || !isComponent(comp)) return { nodes, edges };
  const ids = new Map(comp.data.modules.map((m) => [m.id, newId()]));
  const modules: ModuleFlowNode[] = comp.data.modules.map((m) => ({
    id: ids.get(m.id)!,
    type: m.type,
    position: { x: comp.position.x + m.position.x, y: comp.position.y + m.position.y },
    data: { ...m.data, collapsed: false },
    selected: true,
  }));
  const color = (id: string) => modules.find((m) => m.id === id)?.data.color ?? comp.data.color;
  const inner: CableEdge[] = comp.data.cables.map((c) => ({
    id: newId(),
    type: "cable",
    source: ids.get(c.source)!,
    sourceHandle: c.sourceHandle,
    target: ids.get(c.target)!,
    targetHandle: c.targetHandle,
    data: { color: color(ids.get(c.source)!) },
  }));
  const outer: CableEdge[] = [];
  for (const e of edges) {
    if (e.source !== componentId && e.target !== componentId) {
      outer.push(e);
      continue;
    }
    const port = comp.data.ports.find((p) => p.id === (e.source === componentId ? e.sourceHandle : e.targetHandle));
    if (!port) continue;
    outer.push(
      e.source === componentId
        ? { ...e, source: ids.get(port.node)!, sourceHandle: port.handle, data: { color: color(ids.get(port.node)!) } }
        : { ...e, target: ids.get(port.node)!, targetHandle: port.handle },
    );
  }
  return { nodes: [...nodes.filter((n) => n.id !== componentId), ...modules], edges: [...outer, ...inner] };
}

// A fresh copy of a saved component, ready to drop on the canvas.
export function instantiate(saved: SavedComponent, x: number, y: number): ComponentFlowNode {
  return {
    id: newId(),
    type: COMPONENT,
    position: { x, y },
    data: structuredClone({ ...saved.data, collapsed: false }),
  };
}

// ---- serialization ----

export const PATCH_FORMAT = "harmony2-patch";

export type SerializedPatch = {
  format: typeof PATCH_FORMAT;
  version: 1;
  name?: string;
  nodes: PatchNode[];
  edges: CableEdge[];
};

export function serialize(nodes: PatchNode[], edges: CableEdge[], name?: string): SerializedPatch {
  return {
    format: PATCH_FORMAT,
    version: 1,
    name,
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data }) as PatchNode),
    edges: edges.map(({ id, type, source, sourceHandle, target, targetHandle, data }) => ({
      id,
      type,
      source,
      sourceHandle,
      target,
      targetHandle,
      data,
    })),
  };
}

// Check an untrusted patch (a file, or old storage) and return usable nodes/edges.
// Unknown module kinds and dangling cables are dropped; anything malformed throws.
export function deserialize(raw: unknown): { nodes: PatchNode[]; edges: CableEdge[]; name?: string } {
  const p = raw as Partial<SerializedPatch>;
  if (!p || typeof p !== "object" || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) {
    throw new Error("That file isn't a harmony 2 patch.");
  }
  if (p.format !== undefined && p.format !== PATCH_FORMAT) throw new Error("That file isn't a harmony 2 patch.");

  const okPos = (v: unknown) =>
    !!v && typeof (v as { x: unknown }).x === "number" && typeof (v as { y: unknown }).y === "number";
  const okModule = (type: unknown, data: unknown) =>
    typeof type === "string" && !!moduleDef(type) && !!data && typeof data === "object" && typeof (data as ModuleData).color === "string";

  const nodes: PatchNode[] = [];
  for (const n of p.nodes) {
    if (!n || typeof n.id !== "string" || !okPos(n.position)) continue;
    if (n.type === COMPONENT) {
      const d = n.data as ComponentData;
      if (!d || typeof d.name !== "string" || !Array.isArray(d.modules) || !Array.isArray(d.cables) || !Array.isArray(d.ports)) continue;
      const modules = d.modules.filter((m) => m && typeof m.id === "string" && okPos(m.position) && okModule(m.type, m.data));
      const ids = new Set(modules.map((m) => m.id));
      nodes.push({
        id: n.id,
        type: COMPONENT,
        position: { x: n.position.x, y: n.position.y },
        data: {
          name: d.name,
          color: typeof d.color === "string" ? d.color : randomColor(),
          collapsed: !!d.collapsed,
          modules: modules.map((m) => ({ ...m, data: { ...m.data, params: { ...m.data.params } } })),
          cables: d.cables.filter((c) => c && ids.has(c.source) && ids.has(c.target)),
          ports: d.ports.filter((q) => q && ids.has(q.node) && (q.dir === "in" || q.dir === "out")),
          shown: Array.isArray(d.shown) ? d.shown.filter((s) => ids.has(s)) : [],
        },
      });
    } else if (okModule(n.type, n.data)) {
      const d = n.data as ModuleData;
      nodes.push({
        id: n.id,
        type: n.type,
        position: { x: n.position.x, y: n.position.y },
        data: { color: d.color, collapsed: !!d.collapsed, params: { ...(d.params ?? {}) } },
      } as ModuleFlowNode);
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges = p.edges
    .filter((e) => e && typeof e.id === "string" && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      type: "cable" as const,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      data: { color: typeof e.data?.color === "string" ? e.data.color : "#b0b0b0" },
    }));
  return { nodes, edges, name: typeof p.name === "string" ? p.name : undefined };
}

// ---- localStorage (per browser; a convenience, never the only copy of anything important) ----

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // full or blocked
  }
}

export const storage = { load, store };

export type SavedSetup = { id: string; name: string; savedAt: number; patch: SerializedPatch };
export type SavedComponent = { id: string; name: string; savedAt: number; data: ComponentData };

const SETUPS_KEY = "harmony2:setups:v1";
const COMPONENTS_KEY = "harmony2:components:v1";

export const savedSetups = {
  list: () => load<SavedSetup[]>(SETUPS_KEY, []),
  save(name: string, nodes: PatchNode[], edges: CableEdge[]) {
    const list = this.list().filter((s) => s.name !== name);
    const entry = { id: newId(), name, savedAt: Date.now(), patch: serialize(nodes, edges, name) };
    return store(SETUPS_KEY, [entry, ...list]) ? entry : null;
  },
  remove(id: string) {
    store(SETUPS_KEY, this.list().filter((s) => s.id !== id));
  },
};

export const savedComponents = {
  list: () => load<SavedComponent[]>(COMPONENTS_KEY, []),
  save(data: ComponentData) {
    const list = this.list().filter((c) => c.name !== data.name);
    const entry = { id: newId(), name: data.name, savedAt: Date.now(), data: structuredClone({ ...data, collapsed: false }) };
    return store(COMPONENTS_KEY, [entry, ...list]) ? entry : null;
  },
  remove(id: string) {
    store(COMPONENTS_KEY, this.list().filter((c) => c.id !== id));
  },
};
