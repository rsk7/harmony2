import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths, so the build works from a subpath like GitHub Pages' /harmony2/.
  base: "./",
  plugins: [react()],
});
