import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer (React UI). In development, API calls go to the local Praxis server.
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: "public_static",
  build: { outDir: "dist/renderer", emptyOutDir: true, sourcemap: true },
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:4321", headers: { host: "localhost:4321" } } } },
});
