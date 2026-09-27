import { useCallback, useEffect } from "react";
import { useReactFlow, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { getInstance, moduleDef } from "../audio/engine";
import type { Params } from "../audio/types";
import { innerId, type ComponentData, type ComponentFlowNode, type InnerModule } from "../patch";
import { ModuleBody, useInstance, useMeterLed } from "./ModuleBody";
import { Jack, minHeightForJacks, ModuleHeader } from "./ModuleNode";

// Custom events so the app (which owns nodes/edges) can ungroup or save a component.
export const UNGROUP_EVENT = "harmony2:ungroup";
export const SAVE_COMPONENT_EVENT = "harmony2:save-component";

export function ComponentNode({ id, data, selected }: NodeProps<ComponentFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const compact = !!data.collapsed;
  const inputs = data.ports.filter((p) => p.dir === "in");
  const outputs = data.ports.filter((p) => p.dir === "out");
  const shown = data.modules.filter((m) => data.shown.includes(m.id));
  const titles = sectionTitles(data.modules);

  useEffect(() => updateNodeInternals(id), [compact, id, updateNodeInternals]);

  // LED: the busiest inner module.
  const { root, led } = useMeterLed(() =>
    Math.max(0, ...data.modules.map((m) => getInstance(innerId(id, m.id))?.meter?.() ?? 0)),
  );

  const updateInner = useCallback(
    (moduleId: string, patch: Params) =>
      updateNodeData(id, (n) => {
        const d = n.data as ComponentData;
        return {
          modules: d.modules.map((m) =>
            m.id === moduleId ? { ...m, data: { ...m.data, params: { ...m.data.params, ...patch } } } : m,
          ),
        };
      }),
    [id, updateNodeData],
  );

  const fire = (event: string) => window.dispatchEvent(new CustomEvent(event, { detail: id }));

  return (
    <div
      ref={root}
      className={`module component${selected ? " selected" : ""}${compact ? " compact" : ""}`}
      style={
        {
          "--accent": data.color,
          width: compact ? 200 : 250,
          minHeight: minHeightForJacks(Math.max(inputs.length, outputs.length)),
        } as React.CSSProperties
      }
    >
      <ModuleHeader
        title={data.name}
        description={`custom component: ${data.modules.length} modules`}
        led={led}
        compact={compact}
        onToggle={() => updateNodeData(id, { collapsed: !compact })}
      >
        <button className="icon nodrag" title="save to my components" aria-label="save to my components" onClick={() => fire(SAVE_COMPONENT_EVENT)}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 1.5h6.5L10.5 3.5V10.5H1.5V1.5Z M3.5 1.5V4.5H7.5V1.5 M3.5 10.5V7H8.5V10.5" />
          </svg>
        </button>
        <button className="icon nodrag" title="ungroup into modules" aria-label="ungroup into modules" onClick={() => fire(UNGROUP_EVENT)}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M1.5 1.5h4v4h-4Z M6.5 6.5h4v4h-4Z M6.5 1.5h4v2.5 M1.5 8v2.5h2.5" />
          </svg>
        </button>
      </ModuleHeader>

      {compact ? (
        <div className="module-body">
          <div className="component-summary">{data.modules.map((m) => m.type).join(" · ")}</div>
        </div>
      ) : (
        <div className="component-inner">
          {shown.length === 0 && <div className="component-summary">{data.modules.map((m) => m.type).join(" · ")}</div>}
          {shown.map((m) => (
            <InnerSection
              key={m.id}
              componentId={id}
              module={m}
              title={titles.get(m.id)}
              color={data.color}
              update={updateInner}
            />
          ))}
        </div>
      )}

      {/* Modules without visible controls still need their params pushed to audio. */}
      {data.modules
        .filter((m) => compact || !data.shown.includes(m.id))
        .map((m) => (
          <InnerSync key={m.id} componentId={id} module={m} />
        ))}

      {inputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="target" index={i} />
      ))}
      {outputs.map((p, i) => (
        <Jack key={p.id} id={p.id} label={p.label} type="source" index={i} />
      ))}
    </div>
  );
}

// One inner module's compact controls, driving its (flattened) audio instance.
function InnerSection({
  componentId,
  module,
  title,
  color,
  update,
}: {
  componentId: string;
  module: InnerModule;
  title?: string;
  color: string;
  update: (moduleId: string, patch: Params) => void;
}) {
  const instanceId = innerId(componentId, module.id);
  const { def, instance, params } = useInstance(instanceId, module.type, module.data.params);
  const onUpdate = useCallback((patch: Params) => update(module.id, patch), [module.id, update]);
  return (
    <section className="component-section">
      <div className="component-section-title">{title ?? def.title}</div>
      <ModuleBody def={def} instanceId={instanceId} instance={instance} params={params} color={color} compact update={onUpdate} />
    </section>
  );
}

// "oscillator 1", "oscillator 2" when a kind repeats inside the component.
function sectionTitles(modules: InnerModule[]) {
  const title = (m: InnerModule) => moduleDef(m.type)?.title ?? m.type;
  const totals = new Map<string, number>();
  for (const m of modules) totals.set(title(m), (totals.get(title(m)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    modules.map((m) => {
      const t = title(m);
      const i = (seen.get(t) ?? 0) + 1;
      seen.set(t, i);
      return [m.id, totals.get(t)! > 1 ? `${t} ${i}` : t];
    }),
  );
}

function InnerSync({ componentId, module }: { componentId: string; module: InnerModule }) {
  useInstance(innerId(componentId, module.id), module.type, module.data.params);
  return null;
}
