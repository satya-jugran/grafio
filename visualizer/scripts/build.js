const esbuild = require('esbuild');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const SRC = path.join(DIR, 'src', 'index.ts');
const DIST = path.join(DIR, 'dist');

const COMMON = {
  entryPoints: [SRC],
  bundle: true,
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info',
};

async function build() {
  console.log('Building Grafio Visualizer...');
  
  await esbuild.build({
    ...COMMON,
    outfile: path.join(DIST, 'visualizer.js'),
    format: 'cjs',
    minify: true,
  });

  await esbuild.build({
    ...COMMON,
    outfile: path.join(DIST, 'visualizer.mjs'),
    format: 'esm',
    minify: true,
  });

  console.log('Visualizer bundle built successfully!');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
