import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, MODULES, PRESETS, type Preset } from "../modules";
import type { SavedComponent } from "../patch";

type Props = {
  at: { x: number; y: number }; // screen position
  components: SavedComponent[];
  onAdd: (kind: string) => void;
  onPreset: (preset: Preset) => void;
  onComponent: (c: SavedComponent) => void;
  onDeleteComponent: (id: string) => void;
  onClose: () => void;
};

// Searchable module menu. Type to filter, ↑↓ to move, enter to add.
export function Palette({ at, components, onAdd, onPreset, onComponent, onDeleteComponent, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  type Item = { key: string; group: string; title: string; description: string; run: () => void; remove?: () => void };
  const items = useMemo((): Item[] => {
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    return [
      ...components
        .filter((c) => match(c.name) || match("my components"))
        .map((c) => ({
          key: "component:" + c.id,
          group: "my components",
          title: c.name,
          description: `${c.data.modules.length} modules: ${c.data.modules.map((m) => m.type).join(", ")}`,
          run: () => onComponent(c),
          remove: () => onDeleteComponent(c.id),
        })),
      ...CATEGORIES.flatMap((c) =>
        MODULES.filter((m) => m.category === c.id && (match(m.title) || match(m.description) || match(c.label))).map((m) => ({
          key: m.kind,
          group: c.label,
          title: m.title,
          description: m.description,
          run: () => onAdd(m.kind),
        })),
      ),
      ...PRESETS.filter((p) => match(p.title) || match(p.description) || match("preset")).map((p) => ({
        key: "preset:" + p.id,
        group: "presets",
        title: p.title,
        description: p.description,
        run: () => onPreset(p),
      })),
    ];
  }, [q, onAdd, onPreset, components, onComponent, onDeleteComponent]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  useEffect(() => {
    root.current?.querySelector(".palette-item.cursor")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // don't play notes while typing
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && items[cursor]) {
      items[cursor].run();
      onClose();
    }
  };

  const left = Math.max(16, Math.min(at.x, window.innerWidth - 336));
  const top = Math.max(16, Math.min(at.y, window.innerHeight - 436));
  let lastGroup = "";

  return (
    <div ref={root} className="palette" style={{ left, top }} onKeyDown={onKeyDown} onKeyUp={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className="palette-search"
        placeholder="add a module…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="palette-list">
        {items.length === 0 && <div className="palette-empty">nothing matches “{query}”</div>}
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? it.group : null;
          lastGroup = it.group;
          return (
            <div key={it.key}>
              {header && <div className="palette-group">{header}</div>}
              <div className="palette-row">
                <button
                  className={`palette-item${i === cursor ? " cursor" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    it.run();
                    onClose();
                  }}
                >
                  <span className="palette-title">{it.title}</span>
                  <span className="palette-desc">{it.description}</span>
                </button>
                {it.remove && (
                  <button
                    className={`menu-delete${confirmRemove === it.key ? " confirm" : ""}`}
                    title="remove from my components"
                    aria-label={`remove ${it.title} from my components`}
                    onClick={() => {
                      if (confirmRemove === it.key) {
                        it.remove!();
                        setConfirmRemove(null);
                      } else setConfirmRemove(it.key);
                    }}
                  >
                    {confirmRemove === it.key ? "remove?" : "×"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
