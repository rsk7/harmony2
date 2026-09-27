import { createContext, useContext } from "react";

export type ViewSettings = {
  cables: "physics" | "straight";
  // Grey the cables out and push them behind the modules.
  cablesBack: boolean;
  // 0 = nearly taut, 1 = very droopy. Physics cables only.
  floppiness: number;
};

export const DEFAULT_VIEW: ViewSettings = { cables: "physics", cablesBack: false, floppiness: 0.3 };

export const ViewContext = createContext<ViewSettings>(DEFAULT_VIEW);
export const useView = () => useContext(ViewContext);
