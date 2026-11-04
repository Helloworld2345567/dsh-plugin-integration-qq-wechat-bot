import { build } from 'esbuild';
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
await build({ entryPoints: ['src/client/index.ts'], outfile: 'dist/client.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022' });
await import('../packages/bot-lifecycle/scripts/build.mjs');
await (await import('node:fs/promises')).copyFile('LICENSE','packages/bot-lifecycle/LICENSE');
