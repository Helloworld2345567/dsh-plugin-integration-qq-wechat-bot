import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validatePackageArchive} from './archive-validation.mjs';
import {validateReleaseEntry} from './release-safety.mjs';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-plugin-release-'));
const archiveName = `${packageJson.name}-${packageJson.version}.tgz`;
const archive = path.join(temporary, archiveName);
try {
  const npm = process.env.npm_execpath;
  const windows = process.platform === 'win32';
  const executable = windows ? (npm ? process.execPath : 'npm.cmd') : (npm ?? 'npm');
  const args = windows && npm
    ? [npm, 'pack', '--ignore-scripts', '--pack-destination', temporary, '--json']
    : ['pack', '--ignore-scripts', '--pack-destination', temporary, '--json'];
  const result = spawnSync(executable, args, {encoding: 'utf8', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `npm pack exited ${result.status}`);
  const packed = JSON.parse(result.stdout);
  if (!Array.isArray(packed) || packed.length !== 1 || packed[0].filename !== archiveName) {
    throw new Error('npm pack returned an unexpected archive manifest');
  }
  const validation = await validatePackageArchive(archive);
  const forbidden = validation.entries.flatMap(entry => {
    if (entry.type !== 'file') return [];
    const relative = entry.path.startsWith('package/') ? entry.path.slice('package/'.length) : entry.path;
    const reason = relative === 'fix_plan.md' ? 'Local fix plan is included' : validateReleaseEntry(relative);
    return reason ? [`${entry.path}: ${reason}`] : [];
  });
  if (forbidden.length) throw new Error(`Forbidden package entries: ${forbidden.join(', ')}`);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  console.log(JSON.stringify({status: 'PASS', archive: archiveName, sha256: digest, ...validation}, null, 2));
} finally {
  await rm(temporary, {recursive: true, force: true});
}
