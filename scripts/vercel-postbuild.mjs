#!/usr/bin/env node
/**
 * Verifies that Nitro's Vercel preset emitted Vercel Build Output API v3.
 * We intentionally do not synthesize this layout from dist/, because copying a
 * non-Vercel server bundle into a Node function causes FUNCTION_INVOCATION_FAILED.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const out = resolve(root, ".vercel/output");
const fnDir = join(out, "functions/__server.func");

if (
  existsSync(join(out, "config.json")) &&
  existsSync(join(fnDir, ".vc-config.json")) &&
  (existsSync(join(fnDir, "index.mjs")) || existsSync(join(fnDir, "index.js")))
) {
  console.log("[vercel-postbuild] .vercel/output already present (Nitro vercel preset). Skipping.");
  process.exit(0);
}

console.error("[vercel-postbuild] Missing Nitro Vercel output. Check vite.config.ts nitro({ preset: 'vercel' }).");
process.exit(1);
