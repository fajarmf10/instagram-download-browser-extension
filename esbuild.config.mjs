import { argv } from 'node:process';
import { cp, readFile, writeFile, rm } from 'node:fs/promises';

import pkg from './package.json' with { type: 'json' };
import * as esbuild from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';

const platform = argv[2];
const watch = argv.includes('--watch');

try {
   await rm(`dist/${platform}`, { recursive: true });
} catch { }

const entryPoints = ['src/content/index.ts', 'src/content/loader.ts', 'src/popup/index.tsx', 'src/options/index.ts'];

if (platform === 'chrome') {
   entryPoints.push('src/background/chrome.ts', 'src/xhr.ts', 'src/inject.ts');
}
if (platform === 'firefox') {
   entryPoints.push('src/background/firefox.ts');
}

const buildOptions = {
   entryPoints,
   outdir: `dist/${platform}`,
   bundle: true,
   format: 'esm',
   splitting: true,
   alias: {
      'react': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
   },
   plugins: [
      sassPlugin({
         embedded: true
      }),
      {
         name: 'copy-manifest',
         setup(build) {
            build.onEnd(async () => {
               await cp('public', `dist/${platform}`, { recursive: true });
               const contents = await readFile(`./src/manifest.${platform}.json`, { encoding: 'utf8' });
               const replacedContents = contents.replace(/__MSG_extVersion__/g, pkg.version);
               await writeFile(`dist/${platform}/manifest.json`, replacedContents, { encoding: 'utf8' });
               console.log(`[${Date()}] manifest copied and replaced successfully`);
            });
         },
      },
   ],
};

if (watch) {
   const ctx = await esbuild.context(buildOptions);
   await ctx.watch();
   console.log(`[${Date()}] watching ${platform} build`);
} else {
   await esbuild.build(buildOptions);
}
