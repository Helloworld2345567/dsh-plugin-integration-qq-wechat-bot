import {globSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnCapture, createTestRoot, finalizeTestRoot} from './test-process.mjs';
import {redactEvidence, safeSubprocessEnv} from './test-environment.mjs';

const files = globSync('tests/*.test.ts').sort();
if (!files.length) throw new Error('No TypeScript tests found');
const cli = fileURLToPath(import.meta.resolve('tsx/cli'));
const root = process.cwd();
const temporary = await createTestRoot(root, 'typescript');
const processHome = path.join(temporary, 'home');
const processTemp = await mkdtemp(path.join(tmpdir(), 'dsh-ts-'));
let failed = false;
let evidence;
try {
  await mkdir(processHome, {recursive: true});
  await mkdir(processTemp, {recursive: true});
  const env = safeSubprocessEnv({
    HOME: processHome, USERPROFILE: processHome,
    APPDATA: path.join(processHome, 'appdata'), LOCALAPPDATA: path.join(processHome, 'localappdata'),
    TEMP: processTemp, TMP: processTemp, BOT_TEST_TMP: path.join(temporary, 'fixtures'),
    XDG_CONFIG_HOME: path.join(processHome, 'config'), PIP_CONFIG_FILE: path.join(processHome, 'empty-pip.ini'),
  });
  await mkdir(env.BOT_TEST_TMP, {recursive: true});
  await writeFile(env.npm_config_userconfig, '');
  await writeFile(env.PIP_CONFIG_FILE, '[global]\nno-index = true\n');
  // SQLite-backed fixtures share the repository-local test root. Serializing
  // files avoids Linux runner contention while keeping the full suite within
  // the release gate timeout.
  const result = await spawnCapture(process.execPath, [cli, '--test', '--test-concurrency=1', ...files], {cwd: root, env, timeoutMs: 10 * 60 * 1000});
  if (result.output) console.error(redactEvidence(result.output));
} catch (error) {
  failed = true;
  evidence = {'test-output.log': error.result?.output ?? error.message};
  const diagnostic = error.result?.output ?? error.stack ?? error.message;
  if (diagnostic) console.error(redactEvidence(diagnostic));
  process.exitCode = 1;
}
await finalizeTestRoot(temporary, {failed, evidence});
await rm(processTemp, {recursive: true, force: true});
