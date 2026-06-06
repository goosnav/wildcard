import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = process.env.WC_SERVER_URL ?? "http://localhost:8787";

// Proxy generation calls to the local server so the browser stays same-origin
// (no CORS in the happy path) and the provider key never reaches the client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: SERVER, changeOrigin: true },
      "/health": { target: SERVER, changeOrigin: true },
    },
  },
});
