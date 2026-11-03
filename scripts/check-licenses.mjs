import {readFile} from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8');
const failures = [];
const noticeText = notices.toLowerCase();
const root = lock.packages[''];
for (const group of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(root[group] ?? {})) {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry?.license) failures.push(`${name}: missing lockfile license`);
    if (!entry?.resolved?.startsWith('https://registry.npmjs.org/')) failures.push(`${name}: non-public registry source`);
    const noticeAliases = new Set([
      '@deepseek-ai/dsh', '@deepseek-ai/cordis', '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-commands', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-working-directory', '@deepseek-ai/dsh-skill',
      '@deepseek-ai/dsh-terminal',
    ]);
    if (!noticeText.includes(name.toLowerCase()) && !name.startsWith('@types/') && !noticeAliases.has(name)) failures.push(`${name}: no third-party notice/name reference`);
  }
}
for (const required of [
  'DeepSeek Harness', 'Cordis', 'astr-bot-sakura', 'video_understanding_core',
  'openclaw-weixin', 'AGPL', 'PolyForm Noncommercial', 'Music', 'MIT',
  'Python', 'ws', 'yaml', 'zod', 'silk-wasm',
]) if (!noticeText.includes(required.toLowerCase())) failures.push(`THIRD_PARTY_NOTICES.md missing ${required}`);
for (const requiredFile of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'SECURITY.md']) {
  if (!(packageJson.files ?? []).includes(requiredFile)) failures.push(`package files missing ${requiredFile}`);
}
console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', checked: Object.keys(root.dependencies ?? {}).length + Object.keys(root.devDependencies ?? {}).length, failures}, null, 2));
if (failures.length) process.exitCode = 1;
