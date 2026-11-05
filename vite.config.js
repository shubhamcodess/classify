import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  worker: { format: "es" },
});
