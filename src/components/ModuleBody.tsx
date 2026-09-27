import { useEffect, useRef } from "react";
import { ensureInstance, moduleDef } from "../audio/engine";
import type { ChoiceSpec, Instance, KeySpec, KnobSpec, ModuleDef, Params, ToggleSpec } from "../audio/types";
import { Choice, KeyBinder, Toggle } from "./Controls";
import { useAnimationFrame } from "./hooks";
import { Knob } from "./Knob";

export function defaultParams(def: ModuleDef): Params {
  return Object.fromEntries(Object.entries(def.params).map(([k, s]) => [k, s.default]));
}

// Keeps an audio instance in sync with its params: pushes whatever changed (or
// everything, for a fresh instance) after each render.
export function useInstance(instanceId: string, kind: string, saved: Params) {
  const def = moduleDef(kind)!;
  const instance = ensureInstance(instanceId, kind);
  const params: Params = { ...defaultParams(def), ...saved };
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
  return { def, instance, params };
}

// Drives an LED (and optionally an "active" class) from instance meters every frame.
export function useMeterLed(meters: () => number) {
  const root = useRef<HTMLDivElement>(null);
  const led = useRef<HTMLSpanElement>(null);
  useAnimationFrame(() => {
    const m = meters();
    if (led.current) led.current.style.opacity = String(0.15 + 0.85 * m);
    root.current?.classList.toggle("active", m > 0.5);
  });
  return { root, led };
}

type Props = {
  def: ModuleDef;
  instanceId: string;
  instance: Instance;
  params: Params;
  color: string;
  compact: boolean;
  update: (patch: Params) => void;
};

// A module's controls: its custom panel plus generic choices, knobs, keys and toggles.
// In compact mode only the params the module lists as most relevant are shown.
export function ModuleBody({ def, instanceId, instance, params, color, compact, update }: Props) {
  const visible = Object.entries(def.params).filter(([k, s]) => !s.hidden && (!compact || def.compact.includes(k)));
  const choices = visible.filter(([, s]) => s.type === "choice") as [string, ChoiceSpec][];
  const knobs = visible.filter(([, s]) => s.type === "knob") as [string, KnobSpec][];
  const toggles = visible.filter(([, s]) => s.type === "toggle") as [string, ToggleSpec][];
  const keys = visible.filter(([, s]) => s.type === "key") as [string, KeySpec][];
  const panelProps = { id: instanceId, instance, params, compact, color, update };

  return (
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
  );
}
