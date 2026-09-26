import { useCallback, useEffect, useRef } from "react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { ensureInstance, moduleDef } from "../audio/engine";
import type { ChoiceSpec, Instance, KeySpec, KnobSpec, ModuleDef, Params, ToggleSpec } from "../audio/types";
import { Choice, KeyBinder, Toggle } from "./Controls";
import { useAnimationFrame } from "./hooks";
import { Knob } from "./Knob";

export type ModuleData = { color: string; params: Params; collapsed?: boolean };
export type ModuleFlowNode = Node<ModuleData>;

// Jack layout: first jack sits just under the header, then one every JACK_GAP px.
export const HEADER_HEIGHT = 40;
export const JACK_GAP = 38;
const JACK_TOP = HEADER_HEIGHT + 14;

export function defaultParams(def: ModuleDef): Params {
  return Object.fromEntries(Object.entries(def.params).map(([k, s]) => [k, s.default]));
}

export function ModuleNode({ id, type, data, selected }: NodeProps<ModuleFlowNode>) {
  const def = moduleDef(type)!;
  const instance = ensureInstance(id, type);
  const { updateNodeData } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const params: Params = { ...defaultParams(def), ...data.params };
  const compact = !!data.collapsed;

  // Push changed params to the audio instance (all of them for a new instance).
  const sent = useRef<{ instance: Instance | null; params: Params }>({ instance: null, params: {} });
  useEffect(() => {
    if (sent.current.instance !== instance) sent.current = { instance, params: {} };
    for (const k of Object.keys(def.params)) {
      if (!(k in sent.current.params) || sent.current.params[k] !== params[k]) {
        instance.set?.(k, params[k]);
        sent.current.params[k] = params[k];
      }
    }
  });

  // Jacks move when the module resizes, so let React Flow re-measure them.
  useEffect(() => updateNodeInternals(id), [compact, id, updateNodeInternals]);

  const update = useCallback(
    (patch: Params) => updateNodeData(id, (n) => ({ params: { ...(n.data as ModuleData).params, ...patch } })),
    [id, updateNodeData],
  );

  const root = useRef<HTMLDivElement>(null);
  const led = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    if (!instance.meter) return;
    const m = instance.meter();
    if (led.current) led.current.style.opacity = String(0.15 + 0.85 * m);
    root.current?.classList.toggle("active", m > 0.5);
  });

  const visible = Object.entries(def.params).filter(([k, s]) => !s.hidden && (!compact || def.compact.includes(k)));
  const choices = visible.filter(([, s]) => s.type === "choice") as [string, ChoiceSpec][];
  const knobs = visible.filter(([, s]) => s.type === "knob") as [string, KnobSpec][];
  const toggles = visible.filter(([, s]) => s.type === "toggle") as [string, ToggleSpec][];
  const keys = visible.filter(([, s]) => s.type === "key") as [string, KeySpec][];

  const jacks = Math.max(def.inputs.length, def.outputs.length);
  const width = compact ? (def.compactWidth ?? 180) : (def.width ?? 210);
  const panelProps = { id, instance, params, compact, color: data.color, update };

  return (
    <div
      ref={root}
      className={`module${selected ? " selected" : ""}${compact ? " compact" : ""}`}
      style={
        {
          "--accent": data.color,
          width,
          minHeight: JACK_TOP + Math.max(0, jacks - 1) * JACK_GAP + 30,
        } as React.CSSProperties
      }
    >
      <div className="module-header" onDoubleClick={() => updateNodeData(id, { collapsed: !compact })}>
        {instance.meter && <span ref={led} className="led" />}
        <span className="module-title" title={def.description}>
          {def.title}
        </span>
        <button
          className="collapse nodrag"
          title={compact ? "expand" : "collapse"}
          aria-label={compact ? "expand module" : "collapse module"}
          onClick={() => updateNodeData(id, { collapsed: !compact })}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d={compact ? "M2 3.5 L5 6.5 L8 3.5" : "M2 6.5 L5 3.5 L8 6.5"} />
          </svg>
        </button>
      </div>

      <div className="module-body">
        {def.Panel && <def.Panel {...panelProps} />}
        {choices.map(([k, s]) => (
          <Choice key={k} spec={s} value={params[k] as string} onChange={(v) => update({ [k]: v })} />
        ))}
        {knobs.length > 0 && (
          <div className="knobs">
            {knobs.map(([k, s]) => (
              <Knob
                key={k}
                label={s.label}
                value={params[k] as number}
                min={s.min}
                max={s.max}
                defaultValue={s.default}
                log={s.log}
                step={s.step}
                size={compact ? 36 : 40}
                format={s.format}
                sub={compact ? undefined : s.sub?.(params[k] as number)}
                onChange={(v) => update({ [k]: v })}
              />
            ))}
          </div>
        )}
        {(toggles.length > 0 || keys.length > 0) && (
          <div className="controls">
            {keys.map(([k, s]) => (
              <KeyBinder key={k} spec={s} value={params[k] as string | null} onChange={update} />
            ))}
            {toggles.map(([k, s]) => (
              <Toggle key={k} spec={s} value={params[k] as boolean} onChange={(v) => update({ [k]: v })} />
            ))}
          </div>
        )}
        {!compact && def.Footer && <def.Footer {...panelProps} />}
      </div>

      {def.inputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="target" index={i} />
      ))}
      {def.outputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="source" index={i} />
      ))}
    </div>
  );
}

function Jack({ id, label, type, index }: { id: string; label: string; type: "source" | "target"; index: number }) {
  const top = JACK_TOP + index * JACK_GAP;
  const side = type === "source" ? "out" : "in";
  return (
    <>
      <Handle
        id={id}
        type={type}
        position={type === "source" ? Position.Right : Position.Left}
        className="jack"
        style={{ top }}
        title={`${label} (${side})`}
      />
      <span className={`jack-label ${side}`} style={{ top: top + 12 }}>
        {label}
      </span>
    </>
  );
}
