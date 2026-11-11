// Post-build: copy the manifest into dist and fail the build if the bundled
// module contains a top-level `import` or a `require(` call.
// Buzz loads plugin.js from a blob URL, so any runtime import breaks the plugin.

import { copyFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const bundle = join(dist, "plugin.js");
const manifest = join(root, "manifest.json");

if (!existsSync(bundle)) {
  console.error("postbuild: dist/plugin.js was not produced");
  process.exit(1);
}

copyFileSync(manifest, join(dist, "manifest.json"));

const source = readFileSync(bundle, "utf8");
const problems = [];
if (/^[ \t]*import[ \t(]/m.test(source) || /^[ \t]*import["'*{]/m.test(source)) {
  problems.push("a top-level `import` statement");
}
if (/\brequire[ \t]*\(/.test(source)) {
  problems.push("a `require(` call");
}
if (/react\/jsx-runtime/.test(source)) {
  problems.push("an automatic JSX runtime reference");
}

if (problems.length) {
  console.error(`postbuild: dist/plugin.js must be self-contained but contains ${problems.join(" and ")}`);
  process.exit(1);
}

console.log("postbuild: dist/plugin.js is self-contained; dist/manifest.json written");
