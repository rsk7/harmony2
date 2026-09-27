import { useEffect, useRef, useState } from "react";
import type { SavedSetup } from "../patch";
import { SETUPS, type Setup } from "../modules/setups";

type Props = {
  saved: SavedSetup[];
  currentName: string;
  onLoadBuiltIn: (setup: Setup) => void;
  onLoadSaved: (setup: SavedSetup) => void;
  onDeleteSaved: (id: string) => void;
  onSave: (name: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onNew: () => void;
  onClose: () => void;
};

// Load a built-in or saved setup, save the current one, or move patches in and out as files.
export function SetupsMenu(p: Props) {
  const root = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(p.currentName);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) p.onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [p]);

  const run = (fn: () => void) => () => {
    fn();
    p.onClose();
  };

  return (
    <div
      ref={root}
      className="menu setups-menu"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") p.onClose();
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <form
        className="menu-save"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => p.onSave(name.trim()))();
        }}
      >
        <input value={name} placeholder="name this setup" aria-label="setup name" onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>
          save
        </button>
      </form>

      <div className="menu-scroll">
        <div className="menu-group">my setups</div>
        {p.saved.length === 0 && <div className="menu-empty">Nothing saved yet. Name the current patch above and save it.</div>}
        {p.saved.map((s) => (
          <div key={s.id} className="menu-row">
            <button className="menu-item" onClick={run(() => p.onLoadSaved(s))}>
              <span className="menu-title">{s.name}</span>
              <span className="menu-desc">
                {s.patch.nodes.length} modules · saved {new Date(s.savedAt).toLocaleDateString()}
              </span>
            </button>
            <button
              className={`menu-delete${confirmDelete === s.id ? " confirm" : ""}`}
              title="delete this setup"
              aria-label={`delete ${s.name}`}
              onClick={() => {
                if (confirmDelete === s.id) {
                  p.onDeleteSaved(s.id);
                  setConfirmDelete(null);
                } else setConfirmDelete(s.id);
              }}
            >
              {confirmDelete === s.id ? "delete?" : "×"}
            </button>
          </div>
        ))}

        <div className="menu-group">built-in setups</div>
        {SETUPS.map((s) => (
          <button key={s.id} className="menu-item" onClick={run(() => p.onLoadBuiltIn(s))}>
            <span className="menu-title">{s.title}</span>
            <span className="menu-desc">{s.description}</span>
          </button>
        ))}
      </div>

      <div className="menu-actions">
        <button onClick={run(p.onExport)}>export file</button>
        <button onClick={() => file.current?.click()}>import file</button>
        <button onClick={run(p.onNew)}>new patch</button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(() => p.onImport(f))();
          }}
        />
      </div>
    </div>
  );
}
