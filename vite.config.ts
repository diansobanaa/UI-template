import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

function pythonBackendPlugin() {
  let backendProcess: ReturnType<typeof spawn> | null = null;
  return {
    name: "python-backend-runner",
    configureServer() {
      const client = new net.Socket();
      client.setTimeout(600);
      client.on("connect", () => {
        client.destroy();
        console.log("[vite] Python backend already active on port 8090.");
      });
      client.on("error", () => {
        client.destroy();
        console.log("[vite] Launching Python backend (python -m backend.server)...");
        backendProcess = spawn("python", ["-m", "backend.server"], {
          cwd: __dirname,
          stdio: "inherit",
          shell: true,
        });
        backendProcess.on("error", (err) => {
          console.error("[vite] Could not launch Python backend:", err);
        });
      });
      client.connect(8090, "127.0.0.1");

      const cleanup = () => {
        if (backendProcess) {
          try { backendProcess.kill(); } catch {}
          backendProcess = null;
        }
      };
      process.on("exit", cleanup);
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), pythonBackendPlugin()],
  build: {
    cssCodeSplit: false,
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_PYTHON_DEV_PROXY ?? "http://127.0.0.1:8090",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
