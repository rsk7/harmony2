import { useCallback, useEffect, useRef, useState } from "react";
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
import { allInstances, getInstance, moduleDef, reconcile, resumeAudio } from "./audio/engine";
import type { Instance } from "./audio/types";
import { defaultParams, ModuleNode, type ModuleFlowNode } from "./components/ModuleNode";
import { Palette } from "./components/Palette";
import { CableConnectionLine, PatchCable, type CableEdge } from "./components/PatchCable";
import { DEFAULT_VIEW, ViewContext, type ViewSettings } from "./components/settings";
import { MODULES, type Preset } from "./modules";

const nodeTypes = Object.fromEntries(MODULES.map((m) => [m.kind, ModuleNode]));
const edgeTypes = { cable: PatchCable };

// Saturated picks in the spirit of harmony's random key colors, all readable on white.
const COLORS = [
  "#FF6347", "#1E90FF", "#FFB300", "#32CD32", "#FF1493", "#9370DB",
  "#20B2AA", "#FF8C00", "#DC143C", "#00BFFF", "#8A2BE2", "#3CB371",
];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];
const newId = () => crypto.randomUUID().slice(0, 8);

function makeNode(kind: string, x: number, y: number, extra: Partial<ModuleFlowNode["data"]> = {}): ModuleFlowNode {
  const def = moduleDef(kind)!;
  return {
    id: newId(),
    type: kind,
    position: { x, y },
    data: { color: randomColor(), ...extra, params: { ...defaultParams(def), ...extra.params } },
  };
}

// ---- persistence (per browser, a convenience only) ----

const PATCH_KEY = "patchbay:patch:v1";
const VIEW_KEY = "patchbay:view:v1";

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked; the patch just won't survive a reload
  }
}

function starterPatch(): { nodes: ModuleFlowNode[]; edges: CableEdge[] } {
  return { nodes: [makeNode("oscillator", 0, 0), makeNode("speaker", 380, 20)], edges: [] };
}

function loadPatch() {
  const p = load<{ nodes: ModuleFlowNode[]; edges: CableEdge[] }>(PATCH_KEY);
  if (!p?.nodes?.length) return starterPatch();
  const nodes = p.nodes.filter((n) => n.type && moduleDef(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: (p.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

// ---- keyboard ----

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

// Routes computer-keyboard presses to modules (bound keys, the keyboard module…).
function useKeyRouting(nodesRef: React.RefObject<ModuleFlowNode[]>) {
  useEffect(() => {
    const pressed = new Map<string, Instance[]>();

    const down = (e: KeyboardEvent) => {
      resumeAudio();
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const key = e.key.toLowerCase();
      if (pressed.has(key)) return;
      const used = nodesRef.current
        .map((n) => getInstance(n.id))
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
  }, [nodesRef]);
}

// ---- app ----

function Patchbay() {
  const [initial] = useState(loadPatch);
  const [nodes, setNodes, onNodesChange] = useNodesState<ModuleFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CableEdge>(initial.edges);
  const [view, setView] = useState<ViewSettings>(() => ({ ...DEFAULT_VIEW, ...load<ViewSettings>(VIEW_KEY) }));
  // Palette position on screen; `center` drops new modules mid-screen instead of at it.
  const [palette, setPalette] = useState<{ x: number; y: number; center?: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useKeyRouting(nodesRef);

  useEffect(() => reconcile(nodes, edges), [nodes, edges]);

  useEffect(() => {
    const t = setTimeout(() => save(PATCH_KEY, { nodes, edges }), 400);
    return () => clearTimeout(t);
  }, [nodes, edges]);
  useEffect(() => save(VIEW_KEY, view), [view]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const cableColor = (sourceId: string) => nodesRef.current.find((n) => n.id === sourceId)?.data.color ?? "#b0b0b0";

  const onConnect = useCallback(
    (c: Connection) => {
      resumeAudio();
      setEdges((es) => addEdge({ ...c, type: "cable", data: { color: cableColor(c.source) } }, es));
    },
    [setEdges],
  );

  // Where new modules land: the palette position, or the middle of the screen.
  const dropPoint = () => {
    const s =
      palette && !palette.center ? palette : { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 100 };
    return screenToFlowPosition(s);
  };

  const addModule = useCallback(
    (kind: string) => {
      const p = dropPoint();
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...makeNode(kind, p.x, p.y), selected: true }]);
    },
    [palette, setNodes],
  );

  const addPreset = useCallback(
    (preset: Preset) => {
      // Presets are big: put them below everything already on the page, then show them.
      const existing = nodesRef.current;
      const p = existing.length
        ? {
            x: Math.min(...existing.map((n) => n.position.x)),
            y: Math.max(...existing.map((n) => n.position.y + (n.measured?.height ?? 200))) + 140,
          }
        : dropPoint();
      const minX = Math.min(...preset.modules.map((m) => m.x));
      const minY = Math.min(...preset.modules.map((m) => m.y));
      p.x -= minX;
      p.y -= minY;
      const made = preset.modules.map((m) =>
        makeNode(m.kind, p.x + m.x, p.y + m.y, { params: m.params ?? {}, collapsed: m.collapsed }),
      );
      const cables: CableEdge[] = preset.cables.map(([from, fromPort, to, toPort]) => ({
        id: newId(),
        type: "cable",
        source: made[from].id,
        sourceHandle: fromPort,
        target: made[to].id,
        targetHandle: toPort,
        data: { color: made[from].data.color },
      }));
      const speaker = nodesRef.current.find((n) => n.type === "speaker");
      if (preset.output && speaker) {
        const [from, port] = preset.output;
        cables.push({
          id: newId(),
          type: "cable",
          source: made[from].id,
          sourceHandle: port,
          target: speaker.id,
          targetHandle: "in",
          data: { color: made[from].data.color },
        });
      }
      setNodes((ns) => [...ns, ...made]);
      setEdges((es) => [...es, ...cables]);
      // Wait a beat so React Flow has measured the new modules before framing them.
      setTimeout(() => void fitView({ nodes: made.map((n) => ({ id: n.id })), duration: 400, maxZoom: 1, padding: 0.2 }), 80);
    },
    [palette, setNodes, setEdges],
  );

  const clear = () => {
    if (!confirmClear) return setConfirmClear(true);
    const fresh = starterPatch();
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setConfirmClear(false);
  };

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
          <button className={confirmClear ? "danger" : ""} onClick={clear}>
            {confirmClear ? "clear everything?" : "new patch"}
          </button>
        </div>

        <div className="view-options" role="group" aria-label="cable display">
          <span className="view-label">cables</span>
          <div className="segmented">
            {(["physics", "straight"] as const).map((c) => (
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
          {view.cables === "physics" && (
            <label className="floppiness" title="how much the cables sag and swing">
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
          minZoom={0.2}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#e2e2e2" />
        </ReactFlow>

        {palette && (
          <Palette at={palette} onAdd={addModule} onPreset={addPreset} onClose={() => setPalette(null)} />
        )}

        <div className="hint">
          double-click the background to add · drag from a jack to patch · select + ⌫ to remove · double-click a
          module's title to collapse
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
