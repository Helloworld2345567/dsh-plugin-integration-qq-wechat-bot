import {mkdir, writeFile, readFile, access} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {identity, atomicJson} from './installation.mjs';
import {safeSubprocessEnv, redactEvidence} from './test-environment.mjs';
import {archiveTestPackage, boundedOutput, createTestRoot, killProcessTree, spawnCapture, finalizeTestRoot, runEsbuild, waitForClose} from './test-process.mjs';

const root = process.cwd();
const folder = await createTestRoot(root, 'lifecycle-native');
const home = path.join(folder, 'home');
const profile = path.join(home, 'profiles', 'bots');
const workspaceRoot = path.join(folder, 'workspaces');
const processHome = path.join(workspaceRoot, '.runtime', 'home');
const processTemp = path.join(workspaceRoot, '.runtime', 'tmp');
let env;
let host;
const logs = {value: ''};
let failed = false;
let failureEvidence;
let result;
try {
await mkdir(profile, {recursive: true});
await mkdir(processHome, {recursive: true});
await mkdir(processTemp, {recursive: true});
env = safeSubprocessEnv({
  HOME: processHome, USERPROFILE: processHome, APPDATA: path.join(processHome, 'appdata'), LOCALAPPDATA: path.join(processHome, 'localappdata'),
  TEMP: processTemp, TMP: processTemp, BOT_HOME: home, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents'),
  BOT_DATA_HOME: path.join(home, 'storages', 'bot-integration'), BOT_WORKSPACE_ROOT: workspaceRoot,
  LIFECYCLE_NATIVE_FOLDER: folder, npm_config_store_dir: path.join(processHome, 'localappdata', 'pnpm', 'store'),
  npm_config_userconfig: path.join(home, 'empty.npmrc'), XDG_CONFIG_HOME: path.join(processHome, 'config'),
  PIP_CONFIG_FILE: path.join(processHome, 'empty-pip.ini'), BOT_TEST_TMP: path.join(folder, 'fixtures'),
});
await writeFile(env.npm_config_userconfig, '');
await writeFile(env.PIP_CONFIG_FILE, '[global]\nno-index = true\n');
  await spawnCapture(process.execPath, ['packages/bot-lifecycle/scripts/build.mjs'], {cwd: root, env, timeoutMs: 180_000});
  const make = async (name, broken = false) => {
    const source = path.join(folder, name);
    await mkdir(path.join(source, 'dist'), {recursive: true});
    const version=`0.2.${name === 'old' ? 10 : name === 'next' ? 11 : 12}`;
    await atomicJson(path.join(source, 'package.json'), {name: 'dsh-plugin-integration-qq-wechat-bot', version, type: 'module', exports: './dist/index.js', files: ['dist/*.js', 'cordis.patch.yml'], dshLifecycle:{schemaVersion:1,role:'main',runtimeProtocol:'2.1.0',coordinatorApiRange:'>=2.0.0 <3.0.0',capabilities:['runtime.health','runtime.quiesce','runtime.resume','upgrade.main-hot'],requiredCoordinatorCapabilities:['coordinator.tick','upgrade.main-hot','upgrade.offline-pair']}, dsh: {bundle: {patch: './cordis.patch.yml'}}});
    await writeFile(path.join(source, 'cordis.patch.yml'), '- insert:\n    - id: bot-integration\n      name: dsh-plugin-integration-qq-wechat-bot\n      config: {}\n');
    await writeFile(path.join(source, 'dist', 'client.js'), '// fixture');
    await writeFile(path.join(source, 'dist', 'index.js'), broken ? `throw Error('INJECTED_ACTIVATION_FAILURE');` : `import {fileURLToPath} from 'node:url';import path from 'node:path';import {appendFileSync,readFileSync} from 'node:fs';
export const name='bot-integration';export function apply(ctx){const trace=value=>appendFileSync(path.join(process.env.LIFECYCLE_NATIVE_FOLDER,'trace.txt'),'${name}:'+value+'\\n');const runtime={packageRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),quiesce:async()=>trace('drain'),resumeProcessing:()=>trace('resume'),health:()=>({ready:true})};const coordinator=(process).__DSH_LIFECYCLE_COORDINATOR__,artifactIdentity=JSON.parse(readFileSync(path.join(process.env.LIFECYCLE_NATIVE_FOLDER,'fixture.json'),'utf8')).${name}.identity;const instance=coordinator?.instance??'fixture-${name}';globalThis.__DSH_LIFECYCLE_HANDSHAKE__={protocol:'dsh.lifecycle',schemaVersion:1,role:'main',packageName:'dsh-plugin-integration-qq-wechat-bot',packageVersion:'${version}',runtimeProtocol:'2.1.0',coordinatorApiRange:'>=2.0.0 <3.0.0',instance,artifactIdentity,capabilities:['runtime.health','runtime.quiesce','runtime.resume','upgrade.main-hot'],requiredCoordinatorCapabilities:['coordinator.tick','upgrade.main-hot','upgrade.offline-pair'],runtime};trace('ready');ctx.effect(()=>()=>{trace('dispose');if(globalThis.__DSH_LIFECYCLE_HANDSHAKE__?.runtime===runtime)delete globalThis.__DSH_LIFECYCLE_HANDSHAKE__;});}`);
    const manifest=JSON.parse(await readFile(path.join(source,'package.json'),'utf8'));
    return {source, artifact: {...await archiveTestPackage(source, home, env), identity: await identity(source), packageVersion:manifest.version, lifecycle:{schemaVersion:1,role:'main',packageName:manifest.name,packageVersion:manifest.version,...manifest.dshLifecycle}}};
  };
  const old = await make('old');
  const next = await make('next');
  const broken = await make('broken', true);
  const lifecycleSource=path.join(root,'packages','bot-lifecycle'),lifecycleManifest=JSON.parse(await readFile(path.join(lifecycleSource,'package.json'),'utf8'));
  const lifecycleArtifact={...await archiveTestPackage(lifecycleSource,home,env),identity:await identity(lifecycleSource),packageVersion:lifecycleManifest.version,lifecycle:{schemaVersion:1,role:'coordinator',packageName:lifecycleManifest.name,packageVersion:lifecycleManifest.version,...lifecycleManifest.dshLifecycle}};
  const observer = path.join(folder, 'observer');
  await mkdir(observer, {recursive: true});
  await runEsbuild(['tests/lifecycle-native-plugin.ts', `--outfile=${path.join(observer, 'index.js')}`, '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external'], {cwd: root, env});
  await atomicJson(path.join(observer, 'package.json'), {name: 'dsh-lifecycle-native-fixture', version: '0.0.0', type: 'module', exports: './index.js', dsh: {bundle: {patch: './cordis.patch.yml'}}});
  await writeFile(path.join(observer, 'cordis.patch.yml'), '- insert:\n    - id: bot-lifecycle-native-fixture\n      name: dsh-lifecycle-native-fixture\n');
  await atomicJson(path.join(profile, 'package.json'), {name: 'lifecycle-native-profile', private: true, type: 'module', dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}}});
  await writeFile(path.join(profile, 'cordis.patch.yml'), '- id: skill-filesystem\n  disabled: true\n- id: session-log-deepseek\n  disabled: true\n');
  await atomicJson(path.join(home, 'installation.json'), {schemaVersion: 1, sourceRoot: old.source, projectRoot: old.source, sourceDigest: 'native-fixture', installedFrom: old.artifact.path, current: old.artifact, updatedAt: Date.now()});
  await atomicJson(path.join(home, 'lifecycle-installation.json'), {schemaVersion:1,current:{main:old.artifact,coordinator:lifecycleArtifact},updatedAt:Date.now()});
  await atomicJson(path.join(home, 'evolution', 'native-upgrade.json'), {id: 'native-upgrade', kind: 'upgrade', scopeKey: 'fixture', configId: 'fixture', goal: 'Real isolated native upgrade', phase: 'queued', createdAt: Date.now(), updatedAt: Date.now(), artifact: next.artifact, previous: old.artifact, events: []});
  await atomicJson(path.join(folder, 'fixture.json'), {home, old: old.artifact, next: next.artifact, broken: broken.artifact});
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), `storeDir: ${JSON.stringify(env.npm_config_store_dir)}\n`);
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js');
  const run = args => spawnCapture(process.execPath, [cli, ...args], {cwd: root, env, timeoutMs: 180_000});
  await run(['plugin', '--profile', 'bots', 'add', lifecycleArtifact.path]);
  await run(['plugin', '--profile', 'bots', 'add', old.artifact.path]);
  await run(['plugin', '--profile', 'bots', 'add', observer]);
  const manifest = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'));
  manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-bot-lifecycle', 'dsh-plugin-integration-qq-wechat-bot', 'dsh-lifecycle-native-fixture'])];
  await atomicJson(path.join(profile, 'package.json'), manifest);
  host = spawn(process.execPath, ['scripts/start.mjs', '--port', '0'], {cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  host.stdout.on('data', chunk => boundedOutput(logs, chunk));
  host.stderr.on('data', chunk => boundedOutput(logs, chunk));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await readFile(path.join(folder, 'result.json'), 'utf8')); break; } catch {}
    if (host.exitCode !== null) throw new Error(`Native lifecycle host exited before result (${host.exitCode})`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!result) throw new Error('Native lifecycle test timed out');
  if (result.status !== 'PASS') throw new Error(`Native lifecycle fixture reported ${result.status}: ${result.error ?? '<no safe diagnostic>'}`);
} catch (error) {
  failed = true;
  process.exitCode = 1;
  failureEvidence = {'host.log': logs.value, 'error.txt': redactEvidence(error.stack ?? error), 'subprocess.log': error.result?.output ?? ''};
  console.error(redactEvidence(error.stack ?? error));
  if (error.result?.output) console.error(redactEvidence(error.result.output));
  if (logs.value) console.error(redactEvidence(logs.value));
}
if (!failed) {
  try {
    const state = JSON.parse(await readFile(path.join(home, 'launcher.json'), 'utf8'));
    await fetch(`http://127.0.0.1:${state.port}/stop`, {method: 'POST', headers: {authorization: `Bearer ${state.token}`}, signal: AbortSignal.timeout(5000)});
    if (host && !await waitForClose(host, 25_000)) await killProcessTree(host);
    await access(path.join(home, 'launcher.json')).then(() => { throw new Error('launcher state was not removed'); }, error => { if (error.code !== 'ENOENT') throw error; });
  } catch (error) {
    failed = true;
    process.exitCode = 1;
    failureEvidence = {'host.log': logs.value, 'error.txt': redactEvidence(error.stack ?? error)};
  }
} else if (host) {
  try { await killProcessTree(host); } catch (error) { failureEvidence['cleanup.log'] = redactEvidence(error.stack ?? error); }
}
if (failed && host && !await waitForClose(host, 1000)) {
  try { await killProcessTree(host); }
  catch (error) { failureEvidence = {...failureEvidence, 'cleanup.log': redactEvidence(error.stack ?? error)}; }
}
await finalizeTestRoot(folder, {failed, evidence: failureEvidence, result});
