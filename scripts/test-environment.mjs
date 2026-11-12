import {spawnSync} from 'node:child_process';
import {access, readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const SAFE_ENVIRONMENT_KEYS = /^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE)$/i;
const ALLOWED_TEST_KEYS = new Set(['BOT_TEST_IMAGE_KEY', 'BOT_TEST_ANALYSIS_KEY', 'BOT_TEST_PYTHON', 'BOT_TEST_TMP', 'BOT_TEST_WEB_TOOLS_SOURCE', 'NATIVE_TEST_RESULT', 'LIFECYCLE_NATIVE_FOLDER', 'BOT_HOME', 'BOT_WORKSPACE_ROOT', 'BOT_PERSONAS_ROOT', 'BOT_DATA_HOME', 'BOT_PYTHON', 'BOT_SOURCE_ROOT', 'DSH_HOME', 'DSH_AGENTS_HOME', 'BOT_IMAGE_KEY_ENV', 'npm_config_store_dir', 'npm_config_userconfig', 'PIP_CONFIG_FILE', 'XDG_CONFIG_HOME', 'PYTHONPATH']);
const SENSITIVE_KEY = /(?:TOKEN|KEY|SECRET|PASSWORD|COOKIE|AUTHORIZATION|CREDENTIAL|USER.?ID|GROUP.?ID|ENDPOINT|URL|PROFILE|SESSION)/i;

export function safeSubprocessEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENVIRONMENT_KEYS.test(key) && !SENSITIVE_KEY.test(key)) env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED_TEST_KEYS.has(key) && !SAFE_ENVIRONMENT_KEYS.test(key)) throw new Error(`TEST_ENV_KEY_NOT_ALLOWED: ${key}`);
    if (value !== undefined) env[key] = value;
  }
  env.CI = '1';
  env.NODE_ENV = 'test';
  env.PYTHONNOUSERSITE = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.PIP_CONFIG_FILE ??= process.platform === 'win32' ? 'NUL' : '/dev/null';
  env.PIP_NO_INDEX = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  if (path.isAbsolute(process.env.npm_execpath ?? '') && path.basename(process.env.npm_execpath).toLowerCase() === 'npm-cli.js') env.npm_execpath = process.env.npm_execpath;
  env.npm_config_userconfig ??= path.join(env.TEMP ?? process.cwd(), 'dsh-test-empty.npmrc');
  return env;
}

export function relativeEvidencePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.replaceAll('\\', '/') : '<evidence>';
}

export function redactEvidence(value, root = process.cwd()) {
  return String(value)
    .replaceAll(pathToFileURL(path.resolve(root) + path.sep).href, '<repo>/')
    .replaceAll(root, '<repo>')
    .replace(/\bfile:\/\/(?:\/[A-Za-z]:\/|\/)[^\s"'<>]+/gi, 'file://<path>')
    .replace(/\\\\[^\s"'<>]+/g, '<path>')
    .replace(/(^|[\s"'(=])([A-Za-z]:[\\/])[^\r\n"'<>|]*/gm, '$1<path>')
    .replace(/(^|[\s"'(=])\/(?!\/)[A-Za-z0-9._~+-]+(?:\/[^\s"'<>:,}]+)+/gm, '$1<path>')
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '<url>')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '<redacted-auth>')
    .replace(/(["']?(?:authorization)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s,"';}]+["']?/gi, '$1<redacted>')
    .replace(/(["']?(?:token|ticket|signature|sig|api[_-]?key|access[_-]?key|app[_-]?secret|client[_-]?secret|secret|password|passwd|cookie|credential|user[_-]?id|group[_-]?id|account[_-]?id|session[_-]?id|endpoint|base[_-]?url)["']?\s*[:=]\s*)["']?[^\s,;"'}]+["']?/gi, '$1<redacted>')
    .replace(/([?&](?:token|ticket|signature|sig|key|secret|authorization)=)[^&\s]+/gi, '$1<redacted>');
}

export async function validateTestPython(candidate, env) {
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('BOT_TEST_PYTHON_REQUIRED');
  const probe = runProbe(candidate, ['-c', 'import json,sys; print(json.dumps({"executable":sys.executable,"version":[sys.version_info.major,sys.version_info.minor]}))'], {env, timeoutMs: 10_000});
  if (!probe.ok) throw new Error('BOT_TEST_PYTHON_NOT_STARTABLE');
  let result;
  try { result = JSON.parse(probe.stdout); } catch { throw new Error('BOT_TEST_PYTHON_IDENTITY_INVALID'); }
  if (!Array.isArray(result.version) || result.version[0] !== 3 || ![12, 13].includes(result.version[1]) || typeof result.executable !== 'string') throw new Error('BOT_TEST_PYTHON_VERSION_UNSUPPORTED');
  const executable = await realpath(result.executable);
  if (!(await stat(executable)).isFile()) throw new Error('BOT_TEST_PYTHON_IDENTITY_INVALID');
  return executable;
}

export function runProbe(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: options.timeoutMs ?? 5000, env: options.env ?? safeSubprocessEnv()});
  if (result.error) return {ok: false, error: result.error.message};
  return {ok: result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
}

async function requirementValues(root, file) {
  const text = await readFile(path.join(root, file), 'utf8');
  return text.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean);
}

export async function inspectPython(python = process.env.CI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), root = process.cwd()) {
  const version = runProbe(python, ['--version']);
  if (!version.ok) return {python, version: undefined, validVersion: false, pip: false, packages: [], error: 'python-not-startable'};
  const versionText = `${version.stdout}${version.stderr}`.trim();
  const match = /Python\s+(\d+)\.(\d+)/i.exec(versionText);
  const validVersion = !!match && match[1] === '3' && (match[2] === '12' || match[2] === '13');
  const requirements = [
    ...(await requirementValues(root, 'requirements.txt')).map(value => ({value, optional: false})),
    ...(await requirementValues(root, 'requirements-voice-generation.txt')).map(value => ({value, optional: true})),
  ];
  const probe = String.raw`import importlib.metadata as m, json
from pip._vendor.packaging.requirements import Requirement
items = json.loads(${JSON.stringify(JSON.stringify(requirements))})
rows = []
for item in items:
    req = Requirement(item['value'])
    try:
        version = m.version(req.name)
        rows.append({'name': req.name, 'version': version, 'requirement': str(req.specifier), 'optional': item['optional'], 'satisfies': req.specifier.contains(version, prereleases=True)})
    except m.PackageNotFoundError:
        rows.append({'name': req.name, 'requirement': str(req.specifier), 'optional': item['optional'], 'missing': True, 'satisfies': False})
print(json.dumps(rows))`;
  const pipVersion = runProbe(python, ['-m', 'pip', '--version']);
  const pipCheck = pipVersion.ok ? runProbe(python, ['-m', 'pip', 'check']) : {ok: false};
  const metadata = pipVersion.ok ? runProbe(python, ['-c', probe]) : {ok: false, stdout: ''};
  let packages;
  try { packages = JSON.parse(metadata.stdout); } catch { packages = undefined; }
  const metadataValid = metadata.ok && Array.isArray(packages) && packages.length === requirements.length && packages.every(item => item && typeof item.name === 'string' && typeof item.optional === 'boolean' && typeof item.satisfies === 'boolean');
  return {python, version: versionText, validVersion, pip: pipVersion.ok && pipCheck.ok, packages: metadataValid ? packages : [], error: metadataValid ? undefined : 'python-metadata-probe-failed'};
}

export async function readHarnessVersions(root = process.cwd()) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  let installed;
  try { installed = JSON.parse(await readFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version; } catch {}
  return {node: packageJson.engines?.node, engine: packageJson.engines?.dsh, dependency: packageJson.dependencies?.['@deepseek-ai/dsh'], installed};
}

export function evaluateEnvironment({platform, nodeVersion, harness, packageLock, python, ffmpeg, ffprobe}) {
  const nodeMajor = Number(String(nodeVersion).split('.')[0]);
  const baseInvalid = python.packages.filter(item => !item.optional && (item.missing || !item.satisfies)).map(item => `${item.name}${item.version ? `@${item.version}` : ''}`);
  const optional = python.packages.filter(item => item.optional && (item.missing || !item.satisfies)).map(item => item.name);
  const harnessValid = harness.engine === '0.2.1-rc.5' && harness.dependency === '0.2.1-rc.5' && harness.installed === '0.2.1-rc.5';
  const checks = [
    {name: 'os', status: platform === 'win32' ? 'PASS' : 'OPTIONAL', detail: platform},
    {name: 'node', status: nodeMajor >= 24 ? 'PASS' : 'FAIL', detail: `Node ${nodeMajor}`},
    {name: 'harness', status: harnessValid ? 'PASS' : 'FAIL', detail: harnessValid ? harness.installed : 'engine/dependency/install mismatch'},
    {name: 'python', status: python.validVersion ? 'PASS' : 'FAIL', detail: python.version ?? '<unavailable>'},
    {name: 'ffmpeg', status: ffmpeg ? 'PASS' : 'FAIL', detail: ffmpeg ? 'available' : 'missing'},
    {name: 'ffprobe', status: ffprobe ? 'PASS' : 'FAIL', detail: ffprobe ? 'available' : 'missing'},
    {name: 'python-dependencies', status: baseInvalid.length || !python.pip || python.error ? 'FAIL' : 'PASS', detail: baseInvalid.length ? `missing or incompatible ${baseInvalid.join(', ')}` : python.error ? python.error : !python.pip ? 'pip check failed' : 'base requirements satisfied'},
    {name: 'voice-generation', status: optional.length ? 'OPTIONAL' : 'PASS', detail: optional.length ? `optional missing ${optional.join(', ')}` : 'optional dependencies available'},
    {name: 'package-lock', status: packageLock ? 'PASS' : 'FAIL', detail: packageLock ? 'present' : 'missing'},
  ];
  const failures = checks.filter(check => check.status === 'FAIL');
  return {status: failures.length ? 'FAIL' : 'PASS', checks, python: {validVersion: python.validVersion, pip: python.pip, packages: python.packages.map(({name, version, requirement, optional, satisfies, missing}) => ({name, version, requirement, optional, satisfies, ...(missing ? {missing: true} : {})})), optionalMissing: optional}, failures: failures.map(check => check.name)};
}

export async function checkEnvironment(options = {}) {
  const root = options.root ?? process.cwd();
  const packageLock = await access(path.join(root, 'package-lock.json')).then(() => true, () => false);
  const harness = await readHarnessVersions(root);
  const python = await inspectPython(options.python, root);
  const command = process.platform === 'win32' ? (name => `${name}.exe`) : (name => name);
  const ffmpeg = runProbe(command('ffmpeg'), ['-version']);
  const ffprobe = runProbe(command('ffprobe'), ['-version']);
  return evaluateEnvironment({platform: process.platform, nodeVersion: process.versions.node, harness, packageLock, python, ffmpeg: ffmpeg.ok, ffprobe: ffprobe.ok});
}
