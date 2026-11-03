import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const knownDeferred = new Set([
  '@deepseek-ai/dsh',
  '@modelcontextprotocol/client',
  'fflate',
  '@deepseek-ai/libreoffice-kit',
  'undici',
  'zod',
]);
const root = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const direct = new Set([
  ...Object.keys(root.dependencies ?? {}),
  ...Object.keys(root.devDependencies ?? {}),
]);
const result = spawnSync(process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'npm audit --json'] : ['audit', '--json'],
  {encoding: 'utf8', windowsHide: true});
let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  throw new Error(`npm audit did not return JSON: ${result.stderr || result.stdout}`);
}
const findings = Object.values(report.vulnerabilities ?? {});
const isDeferred = name => name.startsWith('@deepseek-ai/dsh') || name === '@deepseek-ai/libreoffice-kit' || knownDeferred.has(name);
const unexpected = findings.filter(item => !isDeferred(item.name));
const directFindings = findings.filter(item => direct.has(item.name) && !item.name.startsWith('@deepseek-ai/dsh') && (item.nodes ?? []).some(node => node === `node_modules/${item.name}`));
const metadata = report.metadata?.vulnerabilities ?? {};
const sources = Object.values(lock.packages ?? {})
  .filter(item => item.resolved)
  .map(item => item.resolved);
const nonPublicSources = sources.filter(url => !url.startsWith('https://registry.npmjs.org/'));
const missingLicenses = Object.entries(lock.packages ?? {})
  .filter(([name, item]) => name.startsWith('node_modules/') && !item.license)
  .map(([name]) => name);
console.log(JSON.stringify({
  status: unexpected.length || directFindings.length || nonPublicSources.length || missingLicenses.length ? 'FAIL' : 'PASS',
  counts: metadata,
  knownDeferred: findings.filter(item => isDeferred(item.name)).map(item => ({name: item.name, severity: item.severity, range: item.range})),
  unexpected: unexpected.map(item => ({name: item.name, severity: item.severity, range: item.range})),
  directFindings: directFindings.map(item => ({name: item.name, severity: item.severity, range: item.range})),
  nonPublicSources: [...new Set(nonPublicSources)],
  missingLicenses,
}, null, 2));
if (unexpected.length || directFindings.length || nonPublicSources.length || missingLicenses.length) process.exitCode = 1;
