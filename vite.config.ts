import { defineConfig } from "vite";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Dynamic import to use local @vitejs/plugin-react-swc
const react = await import(path.resolve("./node_modules/@vitejs/plugin-react-swc/index.mjs")).then(m => m.default);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
