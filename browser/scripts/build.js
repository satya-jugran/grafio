#!/usr/bin/env node

/**
 * Builds the browser-optimized bundle for Grafio.
 *
 * Produces:
 *   browser/dist/grafio.browser.js      (IIFE — works with <script> tag)
 *   browser/dist/grafio.browser.min.js   (IIFE minified — production)
 *   browser/dist/grafio.browser.mjs      (ESM — works with import)
 *
 * The build uses esbuild to bundle the entire grafio core (Graph, CypherEngine,
 * InMemoryStorageProvider, etc.) into self-contained files with a crypto shim.
 *
 * Usage:
 *   node browser/scripts/build.js
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const SCRIPT_DIR = __dirname;
const BROWSER_DIR = path.resolve(SCRIPT_DIR, '..');
const ROOT_DIR = path.resolve(BROWSER_DIR, '..');
const SRC_DIR = path.join(BROWSER_DIR, 'src');
const DIST_DIR = path.join(BROWSER_DIR, 'dist');
const CRYPTO_SHIM = path.join(SRC_DIR, 'shims', 'crypto-browser.js');
const ENTRY = path.join(SRC_DIR, 'index.ts');

const COMMON_OPTIONS = {
  entryPoints: [ENTRY],
  bundle: true,
  sourcemap: true,
  // Alias 'crypto' → browser shim (rewrites `import { randomUUID } from 'crypto'`)
  alias: {
    crypto: CRYPTO_SHIM,
  },
  // Bundle everything — no external dependencies
  external: [],
  // Target browsers that support crypto.randomUUID()
  target: ['es2020'],
  logLevel: 'info',
  // Define global for IIFE/UMD output
  globalName: 'Grafio',
};

/**
 * Strips comments and collapses blank lines from a .d.ts file.
 * Keeps type/method/parameter names readable — does not obfuscate.
 *
 * @param {string} filePath - Path to the .d.ts file to process
 */
function stripDts(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Remove /* ... */ block comments (JSDoc)
  content = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments
  content = content.replace(/\/\/[^\n]*/g, '');
  // Collapse 3+ consecutive blank lines into 1
  content = content.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing whitespace
  content = content.trim() + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Strips all comments from a JS file, preserving:
 * - Source map URL comments (//# sourceMappingURL=...)
 *
 * @param {string} filePath - Path to the file to process
 */
function stripComments(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Remove /* ... */ block comments (including JSDoc /** ... */)
  content = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove // line comments but keep //# sourceMappingURL
  content = content.replace(/^(\s*)\/\/(?!#)[^\n]*$/gm, '$1');
  // Collapse runs of 3+ blank lines into 2
  content = content.replace(/\n{3,}/g, '\n\n');
  // Trim leading/trailing whitespace
  content = content.trim() + '\n';
  fs.writeFileSync(filePath, content, 'utf8');
}

async function build() {
  console.log('🔨 Building Grafio browser bundle...\n');

  const iifePath = path.join(DIST_DIR, 'grafio.browser.js');
  const minPath = path.join(DIST_DIR, 'grafio.browser.min.js');
  const esmPath = path.join(DIST_DIR, 'grafio.browser.mjs');

  // 1. IIFE build (for <script> tag usage)
  await esbuild.build({
    ...COMMON_OPTIONS,
    outfile: iifePath,
    format: 'iife',
    minifySyntax: true,
    legalComments: 'none',
  });
  stripComments(iifePath);
  console.log('  ✅ grafio.browser.js (IIFE, no comments)');

  // 2. IIFE minified (for production CDN usage)
  await esbuild.build({
    ...COMMON_OPTIONS,
    outfile: minPath,
    format: 'iife',
    minify: true,
  });
  console.log('  ✅ grafio.browser.min.js (IIFE, minified)');

  // 3. ESM build (for modern bundler/import usage)
  await esbuild.build({
    ...COMMON_OPTIONS,
    outfile: esmPath,
    format: 'esm',
    minifySyntax: true,
    legalComments: 'none',
  });
  stripComments(esmPath);
  console.log('  ✅ grafio.browser.mjs (ESM, no comments)');

  // 4. Strip comments from type declarations
  const dtsPath = path.join(BROWSER_DIR, 'types', 'index.d.ts');
  if (fs.existsSync(dtsPath)) {
    stripDts(dtsPath);
    console.log('  ✅ types/index.d.ts (comments stripped)');
  }

  console.log('\n🎉 Browser bundle built successfully!');
  console.log(`   Output: ${DIST_DIR}`);
}

build().catch((err) => {
  console.error('\n❌ Build failed:');
  console.error(err);
  process.exit(1);
});
