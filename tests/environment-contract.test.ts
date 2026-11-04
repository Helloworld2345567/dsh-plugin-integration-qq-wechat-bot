import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
test('environment evaluator blocks unsupported versions and missing tools', async () => {
  const {evaluateEnvironment} = await import('../scripts/test-environment.mjs' as string);
  const result = evaluateEnvironment({platform: 'win32', nodeVersion: '23.0.0', harness: {engine: '0.2.1-rc.1', dependency: '0.2.1-rc.1'}, packageLock: false, ffmpeg: false, ffprobe: false, python: {validVersion: false, version: 'Python 3.11.0', packages: [{name: 'requests', optional: false, missing: true, satisfies: false}, {name: 'edge-tts', optional: true, missing: true, satisfies: false}], pip: true}});
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.failures, ['node', 'harness', 'python', 'ffmpeg', 'ffprobe', 'python-dependencies', 'package-lock']);
  assert.equal(result.checks.find((check: {name: string}) => check.name === 'voice-generation')?.status, 'OPTIONAL');
});

test('environment evaluator passes base tools while optional voice is explicit', async () => {
  const {evaluateEnvironment} = await import('../scripts/test-environment.mjs' as string);
  const result = evaluateEnvironment({platform: 'win32', nodeVersion: '24.17.0', harness: {engine: '0.2.1-rc.2', dependency: '0.2.1-rc.2', installed: '0.2.1-rc.2'}, packageLock: true, ffmpeg: true, ffprobe: true, python: {validVersion: true, version: 'Python 3.13.0', packages: [{name: 'requests', version: '2.34.2', requirement: '<3,>=2.32', optional: false, satisfies: true}, {name: 'edge-tts', requirement: '<8,>=7', optional: true, missing: true, satisfies: false}], pip: true}});
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.python.optionalMissing, ['edge-tts']);
});

test('environment check is read-only and its result contains no secret or absolute path', async t => {
  const {checkEnvironment} = await import('../scripts/test-environment.mjs' as string);
  await mkdir(path.resolve('.codex'), {recursive: true});
  const root = await mkdtemp(path.resolve('.codex/environment-pure-')); t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({engines: {node: '>=24.0.0', dsh: '0.2.1-rc.2'}, dependencies: {'@deepseek-ai/dsh': '0.2.1-rc.2'}}));
  await writeFile(path.join(root, 'package-lock.json'), '{}');
  await writeFile(path.join(root, 'requirements.txt'), 'requests>=2.32,<3\n');
  await writeFile(path.join(root, 'requirements-voice-generation.txt'), 'edge-tts>=7,<8\n');
  await mkdir(path.join(root, 'node_modules', '@deepseek-ai', 'dsh'), {recursive: true});
  await writeFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({version: '0.2.1-rc.2'}));
  await writeFile(path.join(root, 'sentinel'), 'unchanged'); const before = await readdir(root);
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'must-not-leak';
  try {
    const result = await checkEnvironment({root}); const output = JSON.stringify(result);
    assert.deepEqual(await readdir(root), before);
    assert.doesNotMatch(output, /must-not-leak|[A-Za-z]:\\|environment-pure-/);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test('evidence redaction removes paths, URLs, identities and credentials', async () => {
  const {redactEvidence} = await import('../scripts/test-environment.mjs' as string);
  const value = redactEvidence('file:///E:/private/run.js E:/private/out.log \\\\server\\share\\private\\out.log /home/operator/run.log /workspace/private/out.log /github/workspace/repo/out.log endpoint=https://private.invalid/v1 USER_ID=123 GROUP_ID=456 Authorization: Basic cHJpdmF0ZQ== Bearer standalone-secret Basic standalone-basic {"user_id":"123","group_id":"456","token":"secret","appSecret":"hidden"}');
  assert.doesNotMatch(value, /operator|workspace|github|server|share|123|456|hidden|cHJp|standalone|private\.invalid|(?:^|\s)[A-Za-z]:[\\/]|\\\\server|\/(?:home|workspace|github)\//i);
  assert.match(value, /<path>|<url>|<redacted>/);
});

test('test subprocess environment excludes inherited secrets and runtime identity', async () => {
  const {safeSubprocessEnv} = await import('../scripts/test-environment.mjs' as string);
  const previous = {OPENAI_API_KEY: process.env.OPENAI_API_KEY, DSH_PROFILE: process.env.DSH_PROFILE, PATH: process.env.PATH};
  process.env.OPENAI_API_KEY = 'must-not-leak'; process.env.DSH_PROFILE = 'real-profile';
  try {
    const env = safeSubprocessEnv({BOT_HOME: 'fixture-home'});
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.DSH_PROFILE, undefined);
    assert.equal(env.BOT_HOME, 'fixture-home');
    assert.equal(env.CI, '1');
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.PYTHONNOUSERSITE, '1');
    assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
    assert.match(env.npm_config_userconfig ?? '', /dsh-test-empty\.npmrc$/);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
