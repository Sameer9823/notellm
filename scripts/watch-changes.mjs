// Dev-only diagnostic: watches the project root for file changes and logs each
// one with a timestamp + relative path. Used to find whatever process is
// rewriting a file and making `next dev` recompile in a loop ("Compiled in 1ms"
// repeating every few hundred milliseconds -> browser reload -> /sign-in
// refetches forever).
//
// Usage:  node scripts/watch-changes.mjs [durationSeconds]
// Exits after `durationSeconds` (default 60). Watches recursively and ignores
// node_modules, .next, .git, dist, build, coverage, out — i.e. only source and
// config files are reported, which is exactly what Next's compiler reacts to.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const seconds = Number(process.argv[2] ?? 60);
const ignorePrefixes = ["node_modules", ".next", ".git", "dist", "build", "coverage", "out"];

const rel = (p) => path.relative(root, p).replaceAll(path.win32.sep, "/");
const isIgnored = (p) => ignorePrefixes.some((seg) => p === seg || p.startsWith(seg + "/"));

const log = (file, type) => {
  const r = rel(file);
  if (isIgnored(r)) return;
  console.log(`[${new Date().toISOString()}] ${type ?? "CHANGE"}: ${r}`);
};

const watcher = fs.watch(root, { persistent: true, recursive: true }, (eventType, filename) => {
  if (!filename) return;
  const full = path.resolve(root, filename);
  log(full, eventType);
});

// Also watch nested dirs explicitly — on Windows, fs.watch on the root with
// recursive:true should propagate, but some Node builds miss files added in
// subdirectories, so re-scan every few seconds to be sure.
const handle = setInterval(() => {
  // no-op liveness marker so the loop is visibly alive in logs
}, 10_000);

setTimeout(() => {
  clearInterval(handle);
  watcher.close();
  process.exit(0);
}, seconds * 1000);

console.error(`[watch-changes] watching ${root} for ${seconds}s …`);
