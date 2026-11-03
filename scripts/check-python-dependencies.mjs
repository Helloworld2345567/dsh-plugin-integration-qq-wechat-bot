import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const python = process.env.CI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const requirementFiles = ['requirements.txt', 'requirements-voice-generation.txt', 'requirements-ci.txt', 'requirements-voice-generation-ci.txt'];
const failures = [];
for (const file of requirementFiles) {
  const text = await readFile(file, 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.replace(/#.*/, '').trim();
    if (!value) continue;
    if (/^(?:-r|--|git\+|https?:)/i.test(value) || !/^[A-Za-z0-9_.-]+(?:\[[^\]]+\])?(?:[<>=!~].+)?$/.test(value)) {
      failures.push(`${file}:${index + 1}: unsupported or unpinned requirement syntax`);
    }
  }
}
const pipCheck = spawnSync(python, ['-m', 'pip', 'check'], {encoding: 'utf8', windowsHide: true});
if (pipCheck.status !== 0 && /No module named pip/i.test(pipCheck.stderr || '')) failures.push('pip check could not run because pip is missing');
else if (pipCheck.error) failures.push(`pip check could not start: ${pipCheck.error.message}`);
else if (pipCheck.status !== 0) failures.push(`pip check failed: ${pipCheck.stderr || pipCheck.stdout}`.trim());
const probe = String.raw`import importlib.metadata as m, json
names = ['requests', 'Pillow', 'aiohttp', 'pypdf', 'python-docx', 'pypdfium2', 'openpyxl', 'yt-dlp', 'edge-tts']
rows = []
for name in names:
    try:
        metadata = m.metadata(name)
        license_value = metadata.get('License') or metadata.get('License-Expression') or next((item.split(' :: ')[-1] for item in metadata.get_all('Classifier', []) if item.startswith('License :: ')), '')
        rows.append({'name': name, 'version': m.version(name), 'license': license_value})
    except m.PackageNotFoundError:
        rows.append({'name': name, 'missing': True})
print(json.dumps(rows, ensure_ascii=False))`;
const metadata = spawnSync(python, ['-c', probe], {encoding: 'utf8', windowsHide: true});
let packages = [];
try { packages = JSON.parse(metadata.stdout); } catch { failures.push(`Python metadata probe failed: ${metadata.stderr || metadata.stdout}`); }
const optional = new Set(['edge-tts']);
for (const packageInfo of packages) {
  if (packageInfo.missing && !optional.has(packageInfo.name)) failures.push(`${packageInfo.name}: package is not installed`);
}
const missingOptional = packages.filter(packageInfo => packageInfo.missing && optional.has(packageInfo.name)).map(packageInfo => packageInfo.name);
console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', python, packages, missingOptional, failures}, null, 2));
if (failures.length) process.exitCode = 1;
