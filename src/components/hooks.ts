import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Store } from "../audio/util";

export function useStore<T>(store: Store<T>) {
  return useSyncExternalStore(store.subscribe, store.get);
}

// Calls `draw` every animation frame while mounted.
export function useAnimationFrame(draw: () => void) {
  const ref = useRef(draw);
  ref.current = draw;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ref.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}
