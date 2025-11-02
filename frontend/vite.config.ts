import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
