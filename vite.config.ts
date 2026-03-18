import { defineConfig } from "vite";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const react = require("@vitejs/plugin-react-swc");
const { componentTagger } = require("lovable-tagger");

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [(react.default || react)(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
