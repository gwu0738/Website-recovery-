// =============================================================================
// Build a single self-contained HTML file from the modular site.
//
// Why: sandboxed contexts (the Claude artifact preview, and file:// double-click)
// refuse to fetch sibling ES-module files. Inlining everything into one
// <script type="module"> with no imports makes the page run anywhere.
//
//   node web/build-standalone.mjs   ->   web/dist/standalone.html
//
// The modular web/ files stay the source of truth; this is a derived bundle.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

// Dependency order — each file may use things defined above it.
const JS_ORDER = [
  "js/config.js",
  "js/icons.js",
  "js/fairness.js",
  "js/games.js",
  "js/wallet.js",
  "js/api.js",
  "js/wallet-panel.js",
  "js/dice-game.js",
  "js/tower-logic.js",
  "js/tower-game.js",
  "js/chicken-logic.js",
  "js/chicken-game.js",
  "js/chat.js",
  "js/app.js",
];

// Strip ES-module syntax so the files share one module scope.
function stripModuleSyntax(src) {
  return src
    .replace(/^\s*import\s[^\n]*;?\s*$/gm, "") // drop `import ... ;` lines
    .replace(/^(\s*)export\s+/gm, "$1"); // drop leading `export `
}

const bundleJs = JS_ORDER.map(
  (f) => `\n// ===== ${f} =====\n${stripModuleSyntax(read(f))}`,
).join("\n");

const css = read("css/styles.css");

let html = read("index.html")
  .replace(
    /<link rel="stylesheet" href="css\/styles\.css"\s*\/>/,
    `<style>\n${css}\n</style>`,
  )
  .replace(
    /<script type="module" src="js\/app\.js"><\/script>/,
    `<script type="module">\n${bundleJs}\n</script>`,
  );

const outDir = join(here, "dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "standalone.html"), html);
console.log("wrote web/dist/standalone.html (" + html.length + " bytes)");
