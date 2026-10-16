import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { resolveSignalingUrl } from "./src/config/signaling";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command, mode }) => {
  const envDir = fileURLToPath(new URL('../', import.meta.url));
  const environment = loadEnv(mode, envDir, 'VITE_');
  if (command === 'build' && environment.VITE_SIGNALING_URL) {
    resolveSignalingUrl(environment.VITE_SIGNALING_URL, 'https://dropmine.example', true);
  }
  if (command === 'build' && process.env.VERCEL && !environment.VITE_SIGNALING_URL) {
    throw new Error('Set VITE_SIGNALING_URL=wss://your-backend-domain/ws before deploying to Vercel');
  }
  return {
  envDir,
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    watch: { usePolling: Boolean(process.env.WSL_DISTRO_NAME), interval: 300 },
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3001", ws: true },
      "/api": "http://127.0.0.1:3001",
    },
  },
  };
});
