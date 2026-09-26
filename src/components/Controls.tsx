import { useEffect, useRef, useState } from "react";
import type { ChoiceSpec, KeySpec, Params, ToggleSpec } from "../audio/types";

export function Choice({ spec, value, onChange }: { spec: ChoiceSpec; value: string; onChange: (v: string) => void }) {
  return (
    <div className="choice nodrag" role="radiogroup" aria-label={spec.label}>
      {spec.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "selected" : ""}
          title={o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? (
            <svg width="20" height="16" viewBox="0 0 20 16">
              <path d={o.icon} />
            </svg>
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ spec, value, onChange }: { spec: ToggleSpec; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle nodrag${value ? " on" : ""}`} aria-pressed={value} onClick={() => onChange(!value)}>
      {spec.label}
    </button>
  );
}

export function keyLabel(key: string) {
  return key === " " ? "space" : key;
}

// Click, then press a key to bind it. ⌫ clears, esc cancels.
export function KeyBinder({ spec, value, onChange }: { spec: KeySpec; value: string | null; onChange: (patch: Params) => void }) {
  const [binding, setBinding] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  // While binding, capture the next key before anything else (incl. React Flow's delete key).
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        // cancel
      } else if (e.key === "Backspace" || e.key === "Delete") {
        onChange({ key: null });
      } else if (e.key.length === 1) {
        onChange({ key: e.key.toLowerCase(), ...spec.onBind });
      } else {
        return; // ignore modifiers etc., keep listening
      }
      setBinding(false);
    };
    // Clicking elsewhere cancels; clicking the button itself is handled by its onClick.
    const cancel = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setBinding(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", cancel, true);
    };
  }, [binding, onChange, spec.onBind]);

  return (
    <button
      ref={button}
      className={`key-bind nodrag${binding ? " listening" : ""}`}
      title="bind a key: click, then press a key (⌫ clears, esc cancels)"
      onClick={() => setBinding((b) => !b)}
    >
      {binding ? "press a key…" : value ? <kbd>{keyLabel(value)}</kbd> : "bind key"}
    </button>
  );
}
