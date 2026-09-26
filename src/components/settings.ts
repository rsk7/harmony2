import { createContext, useContext } from "react";

export type ViewSettings = {
  cables: "physics" | "straight";
  // Grey the cables out and push them behind the modules.
  cablesBack: boolean;
};

export const DEFAULT_VIEW: ViewSettings = { cables: "physics", cablesBack: false };

export const ViewContext = createContext<ViewSettings>(DEFAULT_VIEW);
export const useView = () => useContext(ViewContext);
