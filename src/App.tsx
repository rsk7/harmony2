import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import { allInstances, getInstance, reconcile, resumeAudio } from "./audio/engine";
import type { Instance } from "./audio/types";
import { ComponentNode, SAVE_COMPONENT_EVENT, UNGROUP_EVENT } from "./components/ComponentNode";
import { GroupDialog } from "./components/GroupDialog";
import { ModuleNode } from "./components/ModuleNode";
import { Palette } from "./components/Palette";
import { CableConnectionLine, PatchCable, type CableEdge } from "./components/PatchCable";
import { migrateView, ViewContext, type ViewSettings } from "./components/settings";
import { SetupsMenu } from "./components/SetupsMenu";
import { MODULES, type Preset } from "./modules";
import type { Setup } from "./modules/setups";
import {
  buildLayout,
  cable,
  COMPONENT,
  deserialize,
  flatten,
  groupModules,
  instantiate,
  isComponent,
  makeNode,
  numberedTitles,
  portCandidates,
  savedComponents,
  savedSetups,
  serialize,
  storage,
  ungroup,
  type PatchNode,
  type PortCandidate,
  type SavedComponent,
  type SavedSetup,
} from "./patch";

const nodeTypes = { ...Object.fromEntries(MODULES.map((m) => [m.kind, ModuleNode])), [COMPONENT]: ComponentNode };
const edgeTypes = { cable: PatchCable };

// The working patch autosaves here (per browser, a convenience only).
const PATCH_KEY = "patchbay:patch:v1";
const VIEW_KEY = "patchbay:view:v1";

type Patch = { nodes: PatchNode[]; edges: CableEdge[]; name?: string };

function starterPatch(): Patch {
  return { nodes: [makeNode("oscillator", 0, 0), makeNode("speaker", 380, 20)], edges: [] };
}

function loadWorkingPatch(): Patch {
  try {
    const p = deserialize(storage.load(PATCH_KEY, null));
    return p.nodes.length ? p : starterPatch();
  } catch {
    return starterPatch();
  }
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patch";
}

// ---- keyboard ----

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

// Routes computer-keyboard presses to modules (bound keys, the keyboard module…),
// including modules inside custom components.
function useKeyRouting(instanceIds: React.RefObject<string[]>) {
  useEffect(() => {
    const pressed = new Map<string, Instance[]>();

    const down = (e: KeyboardEvent) => {
      resumeAudio();
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (pressed.has(key)) return;
      const used = instanceIds.current
        .map((id) => getInstance(id))
        .filter((inst): inst is Instance => !!inst?.onKey?.(key, true));
      if (!used.length) return;
      e.preventDefault(); // e.g. space shouldn't scroll
      pressed.set(key, used);
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      pressed.get(key)?.forEach((inst) => inst.onKey?.(key, false));
      pressed.delete(key);
    };
    const releaseAll = () => {
      pressed.clear();
      for (const inst of allInstances()) inst.releaseKeys?.();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseAll);
    };
  }, [instanceIds]);
}

// ---- app ----

type Toast = { text: string; undo?: Patch };

function Patchbay() {
  const [initial] = useState(loadWorkingPatch);
  const [nodes, setNodes, onNodesChange] = useNodesState<PatchNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdge>(initial.edges);
  const [patchName, setPatchName] = useState(initial.name ?? "");
  const [view, setView] = useState<ViewSettings>(() => migrateView(storage.load<ViewSettings | null>(VIEW_KEY, null)));
  const [palette, setPalette] = useState<{ x: number; y: number; center?: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const [grouping, setGrouping] = useState<{ ids: Set<string>; candidates: PortCandidate[] } | null>(null);
  const [setups, setSetups] = useState<SavedSetup[]>(savedSetups.list);
  const [library, setLibrary] = useState<SavedComponent[]>(savedComponents.list);
  const [toast, setToast] = useState<Toast | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const flat = useMemo(() => flatten(nodes, edges), [nodes, edges]);
  const instanceIds = useRef<string[]>([]);
  instanceIds.current = flat.nodes.map((n) => n.id);
  useKeyRouting(instanceIds);

  useEffect(() => reconcile(flat.nodes, flat.edges), [flat]);

  useEffect(() => {
    const t = setTimeout(() => storage.store(PATCH_KEY, serialize(nodes, edges, patchName || undefined)), 400);
    return () => clearTimeout(t);
  }, [nodes, edges, patchName]);
  useEffect(() => void storage.store(VIEW_KEY, view), [view]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- replacing the whole patch (with undo) ----

  const replacePatch = useCallback(
    (next: Patch, message: string) => {
      const before = { nodes: nodesRef.current, edges: edgesRef.current, name: patchName };
      setNodes(next.nodes);
      setEdges(next.edges);
      setPatchName(next.name ?? "");
      setToast({ text: message, undo: before });
      setTimeout(() => void fitView({ duration: 400, maxZoom: 1, padding: 0.15 }), 80);
    },
    [fitView, patchName, setEdges, setNodes],
  );

  const undo = () => {
    if (!toast?.undo) return;
    setNodes(toast.undo.nodes);
    setEdges(toast.undo.edges);
    setPatchName(toast.undo.name ?? "");
    setToast(null);
  };

  const loadBuiltIn = (s: Setup) => replacePatch({ ...buildLayout(s.layout), name: s.title }, `loaded “${s.title}”`);
  const loadSaved = (s: SavedSetup) => {
    try {
      replacePatch(deserialize(s.patch), `loaded “${s.name}”`);
    } catch (e) {
      setToast({ text: (e as Error).message });
    }
  };

  const saveSetup = (name: string) => {
    const entry = savedSetups.save(name, nodesRef.current, edgesRef.current);
    setSetups(savedSetups.list());
    setPatchName(name);
    setToast({ text: entry ? `saved “${name}”` : "couldn't save: browser storage is full or blocked" });
  };

  const exportFile = () => {
    const data = serialize(nodesRef.current, edgesRef.current, patchName || undefined);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(patchName || "patch")}.harmony2.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (file: File) => {
    try {
      const p = deserialize(JSON.parse(await file.text()));
      if (!p.nodes.length) throw new Error("That patch has no modules this version knows.");
      replacePatch({ ...p, name: p.name ?? file.name.replace(/\.harmony2\.json$|\.json$/, "") }, `imported ${file.name}`);
    } catch (e) {
      setToast({ text: e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message });
    }
  };

  // ---- adding things ----

  const onConnect = useCallback(
    (c: Connection) => {
      resumeAudio();
      const color = nodesRef.current.find((n) => n.id === c.source)?.data.color ?? "#b0b0b0";
      setEdges((es) => addEdge({ ...c, type: "cable", data: { color } }, es));
    },
    [setEdges],
  );

  // Where new modules land: the palette position, or the middle of the screen.
  const dropPoint = () => {
    const s =
      palette && !palette.center ? palette : { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 100 };
    return screenToFlowPosition(s);
  };

  const place = (node: PatchNode) =>
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);

  const addModule = (kind: string) => {
    const p = dropPoint();
    place(makeNode(kind, p.x, p.y));
  };

  const addComponent = (c: SavedComponent) => {
    const p = dropPoint();
    place(instantiate(c, p.x, p.y));
  };

  const addPreset = (preset: Preset) => {
    // Presets are big: put them below everything already on the page, then show them.
    const existing = nodesRef.current;
    const minX = Math.min(...preset.modules.map((m) => m.x));
    const minY = Math.min(...preset.modules.map((m) => m.y));
    const origin = existing.length
      ? {
          x: Math.min(...existing.map((n) => n.position.x)) - minX,
          y: Math.max(...existing.map((n) => n.position.y + (n.measured?.height ?? 200))) + 140 - minY,
        }
      : dropPoint();
    const { nodes: made, edges: cables } = buildLayout(preset, origin);
    const speaker = existing.find((n) => n.type === "speaker");
    if (preset.output && speaker) cables.push(cable(made[preset.output[0]], preset.output[1], speaker, "in"));
    setNodes((ns) => [...ns, ...made]);
    setEdges((es) => [...es, ...cables]);
    setTimeout(() => void fitView({ nodes: made.map((n) => ({ id: n.id })), duration: 400, maxZoom: 1, padding: 0.2 }), 80);
  };

  // ---- components ----

  const selected = nodes.filter((n) => n.selected);
  const selectedModules = selected.filter((n) => !isComponent(n));

  const startGrouping = () => {
    const ids = new Set(selectedModules.map((n) => n.id));
    setGrouping({ ids, candidates: portCandidates(nodesRef.current, edgesRef.current, ids) });
  };

  const makeComponent = (opts: { name: string; ports: PortCandidate[]; shown: string[]; save: boolean }) => {
    if (!grouping) return;
    const result = groupModules(nodesRef.current, edgesRef.current, grouping.ids, opts);
    setNodes(result.nodes);
    setEdges(result.edges);
    if (opts.save) {
      savedComponents.save(result.component.data);
      setLibrary(savedComponents.list());
    }
    setGrouping(null);
    setToast({ text: `made “${opts.name}”${opts.save ? ", added to my components" : ""}` });
  };

  useEffect(() => {
    const onUngroup = (e: Event) => {
      const r = ungroup(nodesRef.current, edgesRef.current, (e as CustomEvent<string>).detail);
      setNodes(r.nodes);
      setEdges(r.edges);
    };
    const onSave = (e: Event) => {
      const comp = nodesRef.current.find((n) => n.id === (e as CustomEvent<string>).detail);
      if (!comp || !isComponent(comp)) return;
      const ok = savedComponents.save(comp.data);
      setLibrary(savedComponents.list());
      setToast({ text: ok ? `“${comp.data.name}” saved to my components` : "couldn't save: browser storage is full or blocked" });
    };
    window.addEventListener(UNGROUP_EVENT, onUngroup);
    window.addEventListener(SAVE_COMPONENT_EVENT, onSave);
    return () => {
      window.removeEventListener(UNGROUP_EVENT, onUngroup);
      window.removeEventListener(SAVE_COMPONENT_EVENT, onSave);
    };
  }, [setEdges, setNodes]);

  return (
    <ViewContext.Provider value={view}>
      <div
        className={`app${view.cablesBack ? " cables-back" : ""}`}
        onPointerDown={resumeAudio}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) setPalette({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="toolbar">
          <span className="brand">harmony 2</span>
          <button className="primary" onClick={() => setPalette({ x: 24, y: 64, center: true })}>
            + add module
          </button>
          <button className={menu ? "selected" : ""} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            setups ▾
          </button>
          {patchName && <span className="patch-name">{patchName}</span>}
        </div>

        <div className="view-options" role="group" aria-label="cable display">
          <span className="view-label">cables</span>
          <div className="segmented">
            {(["table", "straight", "hanging"] as const).map((c) => (
              <button
                key={c}
                className={view.cables === c ? "selected" : ""}
                aria-pressed={view.cables === c}
                onClick={() => setView((v) => ({ ...v, cables: c }))}
              >
                {c}
              </button>
            ))}
          </div>
          {view.cables !== "straight" && (
            <label className="floppiness" title="how much slack the cables have">
              <span>stiff</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={view.floppiness}
                aria-label="cable floppiness"
                onChange={(e) => setView((v) => ({ ...v, floppiness: +e.target.value }))}
              />
              <span>floppy</span>
            </label>
          )}
          <button
            className={view.cablesBack ? "selected" : ""}
            aria-pressed={view.cablesBack}
            title="grey the cables out and push them behind the modules"
            onClick={() => setView((v) => ({ ...v, cablesBack: !v.cablesBack }))}
          >
            {view.cablesBack ? "cables behind" : "cables in front"}
          </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={CableConnectionLine}
          connectionRadius={30}
          deleteKeyCode={["Backspace", "Delete"]}
          zoomOnDoubleClick={false}
          minZoom={0.15}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#e2e2e2" />
        </ReactFlow>

        {selected.length >= 2 && !grouping && (
          <div className="selection-bar">
            <span>{selected.length} selected</span>
            {selected.some(isComponent) ? (
              <span className="dim">ungroup components first to combine them</span>
            ) : (
              <button className="primary" onClick={startGrouping}>
                make component
              </button>
            )}
          </div>
        )}

        {menu && (
          <SetupsMenu
            saved={setups}
            currentName={patchName}
            onLoadBuiltIn={loadBuiltIn}
            onLoadSaved={loadSaved}
            onDeleteSaved={(id) => {
              savedSetups.remove(id);
              setSetups(savedSetups.list());
            }}
            onSave={saveSetup}
            onExport={exportFile}
            onImport={(f) => void importFile(f)}
            onNew={() => replacePatch(starterPatch(), "new patch")}
            onClose={() => setMenu(false)}
          />
        )}

        {palette && (
          <Palette
            at={palette}
            components={library}
            onAdd={addModule}
            onPreset={addPreset}
            onComponent={addComponent}
            onDeleteComponent={(id) => {
              savedComponents.remove(id);
              setLibrary(savedComponents.list());
            }}
            onClose={() => setPalette(null)}
          />
        )}

        {grouping && (
          <GroupDialog
            candidates={grouping.candidates}
            modules={[...numberedTitles(nodes, grouping.ids)].map(([id, title]) => ({ id, title }))}
            onCreate={makeComponent}
            onCancel={() => setGrouping(null)}
          />
        )}

        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}</span>
            {toast.undo && <button onClick={undo}>undo</button>}
          </div>
        )}

        <div className="hint">
          double-click the background to add · drag from a jack to patch · shift-drag to select several · select + ⌫ to
          remove
        </div>
      </div>
    </ViewContext.Provider>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Patchbay />
    </ReactFlowProvider>
  );
}
