import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validatePackageArchive} from './archive-validation.mjs';
import {safeSubprocessEnv, redactEvidence, relativeEvidencePath} from './test-environment.mjs';

export const MAX_OUTPUT_BYTES = 128 * 1024;

export async function createTestRoot(root, prefix) {
  const parent = path.join(root, '.codex');
  await mkdir(parent, {recursive: true});
  return mkdtemp(path.join(parent, `${prefix}-`));
}

export function boundedOutput(state, chunk, maxBytes = MAX_OUTPUT_BYTES) {
  const combined = Buffer.from(`${state.value}${String(chunk)}`, 'utf8');
  let limited = combined.length > maxBytes ? combined.subarray(combined.length - maxBytes) : combined;
  while (limited.length && (limited[0] & 0xc0) === 0x80) limited = limited.subarray(1);
  state.value = limited.toString('utf8');
}

export async function waitForClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  let timer;
  let onClose;
  const closed = new Promise(resolve => { onClose = () => resolve(true); child.once('close', onClose); });
  const timedOut = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref(); });
  const result = await Promise.race([closed, timedOut]);
  clearTimeout(timer);
  if (!result) child.removeListener('close', onClose);
  return result;
}

async function taskkill(pid) {
  const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  if (!await waitForClose(killer, 20_000)) killer.kill();
}

export async function killProcessTree(child, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) await taskkill(child.pid);
  else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  else child.kill('SIGTERM');
  if (await waitForClose(child, timeoutMs)) return;
  if (process.platform === 'win32' && child.pid) await taskkill(child.pid);
  else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
  else child.kill('SIGKILL');
  if (!await waitForClose(child, 5000)) throw new Error('TEST_PROCESS_TREE_KILL_TIMEOUT');
}

export async function runEsbuild(args, options = {}) {
  const cli = fileURLToPath(import.meta.resolve('esbuild/bin/esbuild'));
  return spawnCapture(process.execPath, [cli, ...args], {...options, timeoutMs: options.timeoutMs ?? 180_000});
}

export async function archiveTestPackage(source, home, env) {
  const destination = await createTestRoot(home, 'archive');
  try {
    const npm = [env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(candidate => candidate && path.basename(candidate).toLowerCase() === 'npm-cli.js' && existsSync(candidate));
    if (!npm) throw new Error('TEST_NPM_CLI_MISSING');
    const npmEnv = {...env, npm_config_loglevel: 'silent'};
    delete npmEnv.npm_config_store_dir;
    const packed = await spawnCapture(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], {cwd: source, env: npmEnv, timeoutMs: 180_000, maxOutputBytes: 1024 * 1024});
    const manifest = JSON.parse(packed.output);
    if (!Array.isArray(manifest) || manifest.length !== 1 || path.basename(manifest[0].filename) !== manifest[0].filename) throw new Error('TEST_NPM_PACK_OUTPUT_INVALID');
    const archive = path.join(destination, manifest[0].filename);
    await validatePackageArchive(archive);
    return {path: archive, sha256: createHash('sha256').update(await readFile(archive)).digest('hex')};
  } catch (error) {
    await rm(destination, {recursive: true, force: true});
    throw error;
  }
}

export function spawnCapture(file, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const env = options.env ?? safeSubprocessEnv();
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {cwd: options.cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
    const output = {value: ''};
    child.stdout?.on('data', chunk => boundedOutput(output, chunk, options.maxOutputBytes));
    child.stderr?.on('data', chunk => boundedOutput(output, chunk, options.maxOutputBytes));
    let timedOut = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(Object.assign(error, result ? {result} : {})) : resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void killProcessTree(child).catch(error => finish(new Error(`TEST_PROCESS_TIMEOUT_CLEANUP_FAILED: ${error.message}`), {code: child.exitCode, output: output.value, timedOut: true}));
    }, timeoutMs);
    timer.unref();
    child.once('error', error => finish(error));
    child.once('close', code => {
      const result = {code, output: output.value, timedOut};
      if (code === 0 && !timedOut) finish(undefined, result);
      else finish(new Error(`${path.basename(file)} exited ${code ?? 'unknown'}${timedOut ? ' (timeout)' : ''}`), result);
    });
  });
}

export async function writeFailureEvidence(folder, name, value) {
  await writeFile(path.join(folder, name), redactEvidence(String(value), process.cwd()), {encoding: 'utf8'});
}

export async function removeEmptyTestParent(folder) {
  await rmdir(path.dirname(folder)).catch(error => { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; });
}

export async function finishTestRoot(folder, {failed = false, evidence = {}} = {}) {
  if (failed) {
    const evidenceFolder = `${folder}-evidence`;
    await rm(folder, {recursive: true, force: true});
    await mkdir(evidenceFolder, {recursive: true});
    for (const [name, value] of Object.entries(evidence)) await writeFailureEvidence(evidenceFolder, name, value);
    return relativeEvidencePath(process.cwd(), evidenceFolder);
  }
  await rm(folder, {recursive: true, force: true});
  await removeEmptyTestParent(folder);
  return undefined;
}

export async function finalizeTestRoot(folder, {failed = false, evidence = {}, result} = {}) {
  let finalFailure = failed;
  let location;
  try {
    if (failed) location = await finishTestRoot(folder, {failed: true, evidence});
    else await finishTestRoot(folder);
  } catch (error) {
    finalFailure = true;
    process.exitCode = 1;
    try { location = await finishTestRoot(folder, {failed: true, evidence: {...evidence, 'cleanup-error.txt': error.stack ?? error}}); }
    catch { location = '<cleanup-failed>'; }
  }
  if (finalFailure) console.error(JSON.stringify({status: 'FAIL', evidence: location ?? '<evidence>'}, null, 2));
  else if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  return !finalFailure;
}
