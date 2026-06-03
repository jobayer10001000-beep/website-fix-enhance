#!/usr/bin/env node
/**
 * Transforms `dist/` (produced by `vite build`) into Vercel Build Output API v3
 * layout under `.vercel/output/`.
 *
 *   dist/client/*  -> .vercel/output/static/*
 *   dist/server/*  -> .vercel/output/functions/__server.func/*
 *   + .vercel/output/config.json
 *   + .vercel/output/functions/__server.func/.vc-config.json
 */
import { cp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const out = resolve(root, ".vercel/output");
const staticDir = join(out, "static");
const fnDir = join(out, "functions/__server.func");

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// If Nitro's vercel preset already emitted the Build Output API layout,
// nothing to do.
if (existsSync(join(out, "config.json"))) {
  console.log("[vercel-postbuild] .vercel/output already present (Nitro vercel preset). Skipping.");
  process.exit(0);
}

if (!existsSync(dist)) {
  console.error("[vercel-postbuild] dist/ not found. Run `vite build` first.");
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await mkdir(fnDir, { recursive: true });

// Resolve client/server source dirs (Nitro vercel preset may already emit
// the expected layout; fall back to common variants).
const clientCandidates = [
  join(dist, "client"),
  join(dist, "public"),
];
const serverCandidates = [
  join(dist, "server"),
  join(dist, "_server"),
];

let clientSrc = null;
for (const c of clientCandidates) {
  if (await exists(c)) { clientSrc = c; break; }
}
let serverSrc = null;
for (const c of serverCandidates) {
  if (await exists(c)) { serverSrc = c; break; }
}

if (!clientSrc) {
  console.error("[vercel-postbuild] No client output found in dist/. Looked in:", clientCandidates);
  process.exit(1);
}
if (!serverSrc) {
  console.error("[vercel-postbuild] No server output found in dist/. Looked in:", serverCandidates);
  process.exit(1);
}

console.log(`[vercel-postbuild] Copying ${clientSrc} -> ${staticDir}`);
await cp(clientSrc, staticDir, { recursive: true });

console.log(`[vercel-postbuild] Copying ${serverSrc} -> ${fnDir}`);
await cp(serverSrc, fnDir, { recursive: true });

// Pick an entry file for the function. Prefer index.mjs / index.js if present.
const entryCandidates = ["index.mjs", "index.js", "server.mjs", "server.js"];
let entry = "index.mjs";
for (const c of entryCandidates) {
  if (await exists(join(fnDir, c))) { entry = c; break; }
}

const vcConfig = {
  runtime: "nodejs22.x",
  handler: entry,
  launcherType: "Nodejs",
  supportsResponseStreaming: true,
};
await writeFile(
  join(fnDir, ".vc-config.json"),
  JSON.stringify(vcConfig, null, 2),
);

const config = {
  version: 3,
  routes: [
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/__server" },
  ],
};
await writeFile(join(out, "config.json"), JSON.stringify(config, null, 2));

console.log("[vercel-postbuild] Done. Output at .vercel/output/");
