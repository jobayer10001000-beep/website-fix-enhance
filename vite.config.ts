// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

const nitroPreset = process.env.NITRO_PRESET ?? "vercel";

export default defineConfig({
  // Vercel must receive a Node/Vercel function bundle, not a Worker bundle.
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [
    nitro({
      preset: nitroPreset,
      vercel: {
        entryFormat: "node",
        functions: { runtime: "nodejs22.x" },
      },
    }),
  ],
});
