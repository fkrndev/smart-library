import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

// Tauri expects a fixed port and uses env variables to know where to load from.
const host = process.env.TAURI_DEV_HOST;

// Serve /tts/* (TTS WASM assets) as raw static files in dev. onnxruntime-web
// appends "?import" to the .mjs wrapper it fetches, which makes Vite's public
// dir middleware 500; this middleware bypasses transform and streams the file
// with the right MIME type. In production the files are plain static assets
// and the query is harmless, so this is dev-only.
function serveTtsAssets(): Plugin {
  return {
    name: "serve-tts-assets",
    configureServer(server) {
      const root = path.resolve(__dirname, "public");
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/tts/")) return next();
        const filePath = path.join(root, url);
        if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          return next();
        }
        const type = filePath.endsWith(".wasm")
          ? "application/wasm"
          : filePath.endsWith(".mjs") || filePath.endsWith(".js")
            ? "text/javascript"
            : filePath.endsWith(".data")
              ? "application/octet-stream"
              : "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.setHeader("Content-Length", fs.statSync(filePath).size);
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serveTtsAssets()],
  // Tauri uses a fixed port, so we set it here and prevent Vite from randomly using another one.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // Tell Vite to ignore watching src-tauri
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env variables starting with TAURI_ are exposed to the frontend.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri supports es2021
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome105"
        : "safari13",
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
