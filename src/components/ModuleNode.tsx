import { useCallback, useEffect } from "react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import type { Params } from "../audio/types";
import { ModuleBody, useInstance, useMeterLed } from "./ModuleBody";

export { defaultParams } from "./ModuleBody";

export type ModuleData = { color: string; params: Params; collapsed?: boolean };
export type ModuleFlowNode = Node<ModuleData>;

// Jack layout: first jack sits just under the header, then one every JACK_GAP px.
export const HEADER_HEIGHT = 40;
export const JACK_GAP = 38;
export const JACK_TOP = HEADER_HEIGHT + 14;

export function minHeightForJacks(count: number) {
  return JACK_TOP + Math.max(0, count - 1) * JACK_GAP + 30;
}

export function ModuleNode({ id, type, data, selected }: NodeProps<ModuleFlowNode>) {
  const { def, instance, params } = useInstance(id, type, data.params);
  const { updateNodeData } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const compact = !!data.collapsed;

  // Jacks move when the module resizes, so let React Flow re-measure them.
  useEffect(() => updateNodeInternals(id), [compact, id, updateNodeInternals]);

  const update = useCallback(
    (patch: Params) => updateNodeData(id, (n) => ({ params: { ...(n.data as ModuleData).params, ...patch } })),
    [id, updateNodeData],
  );
  const { root, led } = useMeterLed(() => instance.meter?.() ?? 0);
  const width = compact ? (def.compactWidth ?? 180) : (def.width ?? 210);

  return (
    <div
      ref={root}
      className={`module${selected ? " selected" : ""}${compact ? " compact" : ""}`}
      style={
        {
          "--accent": data.color,
          width,
          minHeight: minHeightForJacks(Math.max(def.inputs.length, def.outputs.length)),
        } as React.CSSProperties
      }
    >
      <ModuleHeader
        title={def.title}
        description={def.description}
        led={instance.meter ? led : undefined}
        compact={compact}
        onToggle={() => updateNodeData(id, { collapsed: !compact })}
      />
      <ModuleBody
        def={def}
        instanceId={id}
        instance={instance}
        params={params}
        color={data.color}
        compact={compact}
        update={update}
      />
      {def.inputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="target" index={i} />
      ))}
      {def.outputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="source" index={i} />
      ))}
    </div>
  );
}

export function ModuleHeader({
  title,
  description,
  led,
  compact,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  led?: React.RefObject<HTMLSpanElement | null>;
  compact: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="module-header" onDoubleClick={onToggle}>
      {led && <span ref={led} className="led" />}
      <span className="module-title" title={description}>
        {title}
      </span>
      {children}
      <button
        className="collapse nodrag"
        title={compact ? "expand" : "collapse"}
        aria-label={compact ? "expand module" : "collapse module"}
        onClick={onToggle}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d={compact ? "M2 3.5 L5 6.5 L8 3.5" : "M2 6.5 L5 3.5 L8 6.5"} />
        </svg>
      </button>
    </div>
  );
}

export function Jack({ id, label, type, index }: { id: string; label: string; type: "source" | "target"; index: number }) {
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
