import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(process.cwd(), "src/renderer-react"),
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(process.cwd(), "dist/renderer-react"),
    emptyOutDir: false
  }
});
