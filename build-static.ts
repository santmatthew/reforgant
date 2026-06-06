/**
 * Build a single self-contained `dist/reforgant.html` — bundles the SPA, then
 * inlines the JS + CSS into one HTML file so it can be opened directly (file://)
 * or dropped on any static host. Fonts + KaTeX still load from CDN (online).
 *
 *   bun run build:single
 */

import { rm } from "node:fs/promises";

await rm("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./web/index.html"],
  outdir: "./dist",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("build failed");
}

let html = "";
let js = "";
let css = "";
for (const out of result.outputs) {
  const text = await out.text();
  if (out.path.endsWith(".html")) html = text;
  else if (out.path.endsWith(".js")) js = text;
  else if (out.path.endsWith(".css")) css = text;
}

// Inline the LOCAL css/js (relative `./` refs). CDN <link>/<script> (absolute
// https URLs) are left untouched.
const single = html
  .replace(/<link\b[^>]*href="\.\/[^"]*\.css"[^>]*>/i, `<style>\n${css}\n</style>`)
  .replace(/<script\b[^>]*src="\.\/[^"]*\.js"[^>]*><\/script>/i, `<script type="module">\n${js}\n</script>`);

await Bun.write("./dist/reforgant.html", single);

const leftoverLocalRefs = /(?:src|href)="\.\//.test(single);
console.log(
  `dist/reforgant.html written (${(single.length / 1024).toFixed(0)} KB). ` +
    `self-contained: ${!leftoverLocalRefs}`,
);
