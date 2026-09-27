import { createContext, useContext } from "react";

export type ViewSettings = {
  // table: physics, lying flat (gravity into the screen). hanging: physics, gravity
  // down the screen. straight: right-angle wires, no physics.
  cables: "table" | "straight" | "hanging";
  // Grey the cables out and push them behind the modules.
  cablesBack: boolean;
  // 0 = nearly taut, 1 = very slack. Physics cables only.
  floppiness: number;
};

export const DEFAULT_VIEW: ViewSettings = { cables: "table", cablesBack: false, floppiness: 0.3 };

// Settings saved by older versions used "physics" for what is now "table".
export function migrateView(saved: Partial<ViewSettings> | null): ViewSettings {
  const v = { ...DEFAULT_VIEW, ...saved };
  if (!["table", "straight", "hanging"].includes(v.cables)) v.cables = "table";
  return v;
}

export const ViewContext = createContext<ViewSettings>(DEFAULT_VIEW);
export const useView = () => useContext(ViewContext);
