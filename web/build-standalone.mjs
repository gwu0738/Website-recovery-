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
  "js/plinko-logic.js",
  "js/games.js",
  "js/wallet.js",
  "js/api.js",
  "js/wallet-panel.js",
  "js/dice-game.js",
  "js/tower-logic.js",
  "js/tower-game.js",
  "js/chicken-logic.js",
  "js/chicken-game.js",
  "js/roulette-logic.js",
  "js/roulette-game.js",
  "js/coinflip-game.js",
  "js/limbo-game.js",
  "js/crash-game.js",
  "js/wheel-game.js",
  "js/plinko-game.js",
  "js/hilo-game.js",
  "js/darts-game.js",
  "js/snakes-game.js",
  "js/keno-game.js",
  "js/mines-game.js",
  "js/chat.js",
  "js/app.js",
];

// Each file becomes its own scope (an IIFE) so same-named private helpers in
// different modules can't collide; its exports are hoisted into shared
// bindings declared once up front, which is what the stripped `import`s of
// later modules resolve to.
const EXPORT_RE = /^(\s*)export\s+(?:async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function bundleModule(src) {
  const exports = [...src.matchAll(EXPORT_RE)].map((m) => m[2]);
  const body = src
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?[ \t]*$/gm, "") // multi-line `import { … } from "…";`
    .replace(/^\s*import\s[^\n]*;?\s*$/gm, "") // single-line `import … ;`
    .replace(/^(\s*)export\s+/gm, "$1"); // drop leading `export `
  const names = [...new Set(exports)];
  const code = names.length
    ? `({ ${names.join(", ")} } = (() => {\n${body}\nreturn { ${names.join(", ")} };\n})());`
    : `(() => {\n${body}\n})();`;
  return { code, exports: names };
}

const modules = JS_ORDER.map((f) => ({ f, ...bundleModule(read(f)) }));
const allExports = [...new Set(modules.flatMap((m) => m.exports))];
const bundleJs =
  `let ${allExports.join(", ")};\n` +
  modules.map((m) => `\n// ===== ${m.f} =====\n${m.code}`).join("\n");

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
