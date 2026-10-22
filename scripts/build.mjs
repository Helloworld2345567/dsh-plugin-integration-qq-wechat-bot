import { build } from 'esbuild';
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
await build({ entryPoints: ['src/client/index.ts'], outfile: 'dist/client.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022' });
await build({entryPoints:['src/mode.ts'],outfile:'packages/bot-unified-chat/dist/index.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await (await import('node:fs/promises')).copyFile('LICENSE','packages/bot-unified-chat/LICENSE');
await build({entryPoints:['src/lifecycle/index.ts'],outfile:'packages/bot-lifecycle/dist/index.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await (await import('node:fs/promises')).copyFile('LICENSE','packages/bot-lifecycle/LICENSE');
