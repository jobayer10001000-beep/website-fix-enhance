// @lovable.dev/vite-tanstack-config already includes the TanStack/React/Tailwind
// plugins, env injection, aliases, error loggers, and sandbox dev-server config.
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
