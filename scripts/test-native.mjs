import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {redactEvidence, safeSubprocessEnv, validateTestPython} from './test-environment.mjs';
import {createTestRoot, killProcessTree, boundedOutput, finalizeTestRoot, runEsbuild, spawnCapture} from './test-process.mjs';

const root = process.cwd();
const folder = await createTestRoot(root, 'native');
const fixture = path.join(folder, 'fixture');
const home = path.join(folder, 'home');
const workspaceRoot = path.join(folder, 'workspaces');
const processHome = path.join(workspaceRoot, '.runtime', 'home');
const processTemp = await mkdtemp(path.join(tmpdir(), 'dsh-native-'));
let env;
let host;
let logs = {value: ''};
let failed = false;
let failureEvidence;
let result;
try {
await mkdir(fixture, {recursive: true});
await mkdir(path.join(home, 'profiles', 'bots'), {recursive: true});
await mkdir(processHome, {recursive: true});
await mkdir(processTemp, {recursive: true});
let webToolsSource;
if (process.env.BOT_TEST_WEB_TOOLS_SOURCE) {
  webToolsSource = await realpath(path.resolve(process.env.BOT_TEST_WEB_TOOLS_SOURCE));
  const relative = path.relative(root, webToolsSource);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('BOT_TEST_WEB_TOOLS_SOURCE must be a reviewed package inside this checkout');
  const manifest = JSON.parse(await readFile(path.join(webToolsSource, 'package.json'), 'utf8'));
  if (manifest.name !== 'dsh-web-tools') throw new Error('BOT_TEST_WEB_TOOLS_SOURCE package name must be dsh-web-tools');
}
const testPythonCandidate = process.env.BOT_TEST_PYTHON;
if (!testPythonCandidate) throw new Error('BOT_TEST_PYTHON must explicitly name the Python 3.12/3.13 test interpreter');
env = safeSubprocessEnv({
  HOME: processHome, USERPROFILE: processHome, APPDATA: path.join(processHome, 'appdata'), LOCALAPPDATA: path.join(processHome, 'localappdata'), TEMP: processTemp, TMP: processTemp,
  BOT_HOME: home, DSH_HOME: home, BOT_PERSONAS_ROOT: path.join(home, 'personas'),
  BOT_WORKSPACE_ROOT: workspaceRoot, DSH_AGENTS_HOME: path.join(home, 'agents'),
  BOT_DATA_HOME: path.join(home, 'storages', 'bot-integration'),
  BOT_IMAGE_KEY_ENV: 'BOT_TEST_IMAGE_KEY', BOT_TEST_IMAGE_KEY: 'fixture-not-a-real-key',
  NATIVE_TEST_RESULT: path.join(folder, 'result.json'), npm_config_store_dir: path.join(processHome, 'localappdata', 'pnpm', 'store'),
  XDG_CONFIG_HOME: processHome, PIP_CONFIG_FILE: path.join(processHome, 'empty.pip.ini'), BOT_TEST_TMP: path.join(folder, 'fixtures'),
  ...(webToolsSource ? {BOT_TEST_WEB_TOOLS_SOURCE: webToolsSource} : {}),
});
const testPython = await validateTestPython(testPythonCandidate, env);
env.BOT_PYTHON = testPython;
env.BOT_TEST_PYTHON = testPython;
await mkdir(path.dirname(env.PIP_CONFIG_FILE), {recursive: true});
await writeFile(env.PIP_CONFIG_FILE, '[global]\nno-index = true\n');
await writeFile(env.npm_config_userconfig, '');
  await runEsbuild(['src/index.ts', '--outfile=dist/index.js', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external'], {cwd: root, env});
  await runEsbuild(['tests/native-plugin.ts', `--outfile=${path.join(fixture, 'index.js')}`, '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external'], {cwd: root, env});
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({name: 'dsh-bot-native-fixture', version: '0.0.0', type: 'module', exports: './index.js', dsh: {bundle: {patch: './cordis.patch.yml'}}}));
  await writeFile(path.join(fixture, 'cordis.patch.yml'), '- insert:\n    - id: bot-native-fixture\n      name: dsh-bot-native-fixture\n');
  await writeFile(path.join(home, 'profiles', 'bots', 'package.json'), JSON.stringify({name: 'native-smoke-profile', private: true, type: 'module', dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}}}));
  await writeFile(path.join(home, 'profiles', 'bots', 'cordis.patch.yml'), '- id: skill-filesystem\n  disabled: true\n- id: session-log-deepseek\n  disabled: true\n- id: session-query-sqlite\n  config:\n    path: ":memory:"\n    openAt: first-search\n- id: bot-integration\n  config:\n    autoStart: false\n');
  const resultPath = env.NATIVE_TEST_RESULT;
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
  const run = args => spawnCapture(process.execPath, [cli, ...args], {cwd: root, env, timeoutMs: 180_000});
  await run(['plugin', '--profile', 'bots', 'add', root]);
  await run(['plugin', '--profile', 'bots', 'add', fixture]);
  if (webToolsSource) {
    await run(['plugin', '--profile', 'bots', 'add', webToolsSource]);
    const manifestPath = path.join(home, 'profiles', 'bots', 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-web-tools'])];
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  host = spawn(process.execPath, [cli, '--profile', 'bots', '--no-open', '--port', '0'], {cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  host.stdout.on('data', chunk => boundedOutput(logs, chunk)); host.stderr.on('data', chunk => boundedOutput(logs, chunk));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(resultPath, 'utf8')); break; } catch {}
    if (host.exitCode !== null) throw new Error(`Native fixture exited before result (${host.exitCode})`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!result) throw new Error('Native fixture timed out');
  if (result.status !== 'PASS') throw new Error(`Native fixture reported ${result.status}: ${result.error ?? '<no safe diagnostic>'}`);
} catch (error) {
  failed = true; process.exitCode = 1;
  failureEvidence = {'host.log': logs.value, 'error.txt': error.stack ?? error};
  console.error(redactEvidence(error.stack ?? error));
  if (logs.value) console.error(redactEvidence(logs.value));
}
if (host) {
  try { await killProcessTree(host); }
  catch (error) { failed = true; process.exitCode = 1; failureEvidence = {...failureEvidence, 'cleanup-error.txt': error.stack ?? error}; }
}
await finalizeTestRoot(folder, {failed, evidence: failureEvidence, result});
await rm(processTemp, {recursive: true, force: true});
