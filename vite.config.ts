// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// For Vercel deployment we disable the Cloudflare Worker plugin (otherwise the
// build produces a workerd bundle that crashes inside Vercel's Node runtime
// with FUNCTION_INVOCATION_FAILED) and switch the TanStack Start / Nitro
// preset to "vercel" so the build emits the Vercel Build Output API v3 layout
// directly into .vercel/output/.
const isVercel = !!process.env.VERCEL || process.env.NITRO_PRESET === "vercel";

export default defineConfig({
  cloudflare: isVercel ? false : undefined,
  tanstackStart: {
    server: { entry: "server" },
    target: isVercel ? "vercel" : undefined,
  },
});
