import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // React Compiler (Phase 2). @vitejs/plugin-react is < 6.0.0, so the compiler
    // is enabled via the Babel plugins hook rather than reactCompilerPreset.
    // React 19 ships the compiler runtime, so react-compiler-runtime is not needed.
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"]
      }
    })
  ],
  resolve: {
    alias: {
      "@weather": resolve(__dirname, "src/assets/weather")
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY ?? "http://localhost:4000",
        changeOrigin: true
      },
      "/ws": {
        target: process.env.VITE_DEV_API_PROXY ?? "http://localhost:4000",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
