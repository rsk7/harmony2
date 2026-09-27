import { useMemo, useState } from "react";
import type { PortCandidate } from "../patch";

type Props = {
  candidates: PortCandidate[];
  modules: { id: string; title: string }[];
  onCreate: (opts: { name: string; ports: PortCandidate[]; shown: string[]; save: boolean }) => void;
  onCancel: () => void;
};

// Turn a selection of modules into a custom component: name it, pick which jacks it
// exposes and whose controls show on its panel.
export function GroupDialog({ candidates, modules, onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  // Pre-tick jacks with cables crossing the selection, plus outputs not used inside it.
  const [ports, setPorts] = useState(
    () => new Set(candidates.filter((c) => c.boundary || (c.dir === "out" && !c.internal)).map((c) => c.id)),
  );
  const [shown, setShown] = useState(() => new Set(modules.map((m) => m.id)));
  const [save, setSave] = useState(true);

  const dropped = useMemo(() => candidates.filter((c) => c.boundary && !ports.has(c.id)), [candidates, ports]);
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onCreate({ name: trimmed, ports: candidates.filter((c) => ports.has(c.id)), shown: [...shown], save });
  };

  const jackList = (dir: "in" | "out") => (
    <fieldset className="dialog-group">
      <legend>{dir === "in" ? "inputs" : "outputs"}</legend>
      {candidates
        .filter((c) => c.dir === dir)
        .map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={ports.has(c.id)} onChange={() => setPorts((s) => toggle(s, c.id))} />
            <span>
              {c.module} <b>{c.label}</b>
            </span>
            {c.boundary && <span className="tag">cabled</span>}
            {c.internal && !c.boundary && <span className="tag dim">used inside</span>}
          </label>
        ))}
    </fieldset>
  );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="dialog"
        role="dialog"
        aria-label="make a component"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation(); // don't play notes while typing
          if (e.key === "Escape") onCancel();
        }}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <h2>make a component</h2>
        <p className="dialog-note">
          {modules.length} modules become one. Pick which jacks it has and whose controls show on its panel.
        </p>
        <label className="dialog-field">
          <span>name</span>
          <input autoFocus value={name} placeholder="e.g. bass voice" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="dialog-columns">
          {jackList("in")}
          {jackList("out")}
        </div>

        <fieldset className="dialog-group">
          <legend>controls on the panel</legend>
          <div className="chips">
            {modules.map((m) => (
              <label key={m.id} className="check chip">
                <input type="checkbox" checked={shown.has(m.id)} onChange={() => setShown((s) => toggle(s, m.id))} />
                <span>{m.title}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {dropped.length > 0 && (
          <p className="dialog-warn">
            {dropped.length === 1 ? "1 cable" : `${dropped.length} cables`} plugged into unticked jacks will be unplugged.
          </p>
        )}

        <div className="dialog-actions">
          <label className="check">
            <input type="checkbox" checked={save} onChange={() => setSave((s) => !s)} />
            <span>add to my components</span>
          </label>
          <button type="button" onClick={onCancel}>
            cancel
          </button>
          <button type="submit" className="primary" disabled={!trimmed}>
            make component
          </button>
        </div>
      </form>
    </div>
  );
}
