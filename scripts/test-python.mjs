import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createTestRoot, finalizeTestRoot, spawnCapture} from './test-process.mjs';
import {redactEvidence, safeSubprocessEnv, validateTestPython} from './test-environment.mjs';

const root = process.cwd();
const temporary = await createTestRoot(root, 'python');
const home = path.join(temporary, 'home');
const temp = path.join(temporary, 'tmp');
let failed = false;
let evidence;
try {
  await mkdir(home, {recursive: true});
  await mkdir(temp, {recursive: true});
  const candidate = process.env.BOT_TEST_PYTHON || process.env.CI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const env = safeSubprocessEnv({
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    TEMP: temp, TMP: temp, BOT_TEST_TMP: path.join(temporary, 'fixtures'),
    XDG_CONFIG_HOME: path.join(home, 'config'), PIP_CONFIG_FILE: path.join(home, 'empty-pip.ini'),
  });
  await mkdir(env.BOT_TEST_TMP, {recursive: true});
  await writeFile(env.PIP_CONFIG_FILE, '[global]\nno-index = true\n');
  await writeFile(env.npm_config_userconfig, '');
  const python = await validateTestPython(candidate, env);
  const result = await spawnCapture(python, ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], {cwd: root, env, timeoutMs: 10 * 60 * 1000});
  if (result.output) console.error(redactEvidence(result.output));
} catch (error) {
  failed = true;
  evidence = {'test-output.log': error.result?.output ?? error.message};
  process.exitCode = 1;
}
await finalizeTestRoot(temporary, {failed, evidence});
