import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.DASHBOARD_API_URL ?? "http://127.0.0.1:3000";
const proxy = { "/api": target, "/health": target };
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5174, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
});
