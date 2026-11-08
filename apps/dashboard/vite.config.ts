import "../../packages/core/load-env.ts";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.DASHBOARD_API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? 3000}`;
const port = Number(process.env.DASHBOARD_PORT ?? 5174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DASHBOARD_PORT");
const proxy = { "/api": target, "/health": target };
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
});
