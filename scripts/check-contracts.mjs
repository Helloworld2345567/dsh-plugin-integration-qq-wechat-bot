import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const documentation = ['CONTRIBUTING.md', 'CONTRIBUTING.en.md', 'docs/development.md', 'docs/en/development.md', 'docs/testing.md', 'docs/en/testing.md'];
const files = [...documentation, '.github/workflows/ci.yml', 'scripts/test-typescript.mjs', 'scripts/test-native.mjs', 'scripts/test-lifecycle-native.mjs', 'scripts/test-install-smoke.mjs', 'scripts/test-process.mjs'];
const text = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file), 'utf8')])));
const failures = [];
const scripts = packageJson.scripts ?? {};
const commands = [...new Set(documentation.flatMap(file => [...text[file].matchAll(/npm run ([a-z0-9:_-]+)/gi)].map(match => match[1])))];
for (const command of commands) if (!scripts[command]) failures.push(`documented npm script missing: ${command}`);
for (const command of ['check:architecture', 'typecheck', 'test', 'test:python', 'check:python-dependencies', 'check:environment', 'build', 'check:docs', 'check:contracts', 'check:licenses', 'check:release', 'verify:release', 'release:pack', 'test:native', 'test:lifecycle-native', 'test:install-smoke']) {
  for (const file of ['docs/testing.md', 'docs/en/testing.md']) if (!text[file].includes(`npm run ${command}`)) failures.push(`${file}: testing contract missing: ${command}`);
}
for (const [chinese, english] of [['CONTRIBUTING.md', 'CONTRIBUTING.en.md'], ['docs/development.md', 'docs/en/development.md'], ['docs/testing.md', 'docs/en/testing.md']]) {
  const documented = file => [...new Set([...text[file].matchAll(/npm run ([a-z0-9:_-]+)/gi)].map(match => match[1]))].sort().join(',');
  if (documented(chinese) !== documented(english)) failures.push(`${english}: npm command contract differs from ${chinese}`);
}
if (packageJson.engines?.node !== '>=24.0.0') failures.push('package Node engine is not Node 24+');
if (packageJson.engines?.dsh !== '0.2.1-rc.5') failures.push('package Harness engine changed');
for (const variable of ['BOT_TEST_PYTHON', 'BOT_TEST_TMP', 'BOT_TEST_WEB_TOOLS_SOURCE', 'NATIVE_TEST_RESULT', 'LIFECYCLE_NATIVE_FOLDER']) for (const file of ['docs/testing.md', 'docs/en/testing.md']) if (!text[file].includes(variable)) failures.push(`${file}: testing variable not classified: ${variable}`);
if (!/(?:不得|不)发送平台消息/.test(text['docs/testing.md'])) failures.push('testing boundary must forbid real platform messages');
if (!/do not send platform messages/i.test(text['docs/en/testing.md'])) failures.push('English testing boundary must forbid real platform messages');
for (const file of documentation) if (!text[file].includes('0.2.1-rc.5') || !/3\.12/.test(text[file]) || !/3\.13/.test(text[file])) failures.push(`${file}: supported runtime versions missing`);
for (const file of ['scripts/test-typescript.mjs', 'scripts/test-native.mjs', 'scripts/test-lifecycle-native.mjs', 'scripts/test-install-smoke.mjs']) {
  if (text[file].includes('{...process.env}') || text[file].includes('{ ...process.env }')) failures.push(`${file}: copies the complete host environment`);
  if (!text[file].includes('safeSubprocessEnv')) failures.push(`${file}: does not use the test environment allowlist`);
}
for (const file of ['scripts/test-native.mjs', 'scripts/test-lifecycle-native.mjs', 'scripts/test-install-smoke.mjs']) {
  if (!text[file].includes("'--port', '0'") && !text[file].includes("'--port','0'")) failures.push(`${file}: native host must use a dynamic port`);
  if (!text[file].includes('killProcessTree')) failures.push(`${file}: native host lacks process-tree cleanup`);
}
if (!text['scripts/test-native.mjs'].includes('BOT_TEST_WEB_TOOLS_SOURCE') || !text['scripts/test-native.mjs'].includes("manifest.name !== 'dsh-web-tools'")) failures.push('native web-tools fixture source is not validated');
if (!text['scripts/test-process.mjs'].includes('timeoutMs') || !text['scripts/test-process.mjs'].includes('killProcessTree')) failures.push('test subprocess helper lacks timeout/tree cleanup');
if (text['.github/workflows/ci.yml'].includes("path: '*.tgz'")) failures.push('CI must not upload the temporary release archive');
if (packageJson.scripts['check:architecture'] !== 'node scripts/check-architecture.mjs') failures.push('architecture gate entry changed');
if (!String(packageJson.scripts['verify:release']).startsWith('npm run check:architecture && ')) failures.push('verify:release does not start with the architecture gate');
if (!text['.github/workflows/ci.yml'].includes('npm run verify:release')) failures.push('CI does not execute the release gate containing architecture checks');
if (packageJson.scripts.prepublishOnly !== 'npm run verify:release') failures.push('prepublishOnly release gate changed');
if (!String(packageJson.scripts['release:pack']).includes('release-pack.mjs')) failures.push('release:pack implementation changed');
console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', commands, failures}, null, 2));
if (failures.length) process.exitCode = 1;
