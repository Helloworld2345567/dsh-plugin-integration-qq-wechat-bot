import {readFile} from 'node:fs/promises';
import {inspectPython} from './test-environment.mjs';

const requirementFiles = ['requirements.txt', 'requirements-voice-generation.txt', 'requirements-ci.txt', 'requirements-voice-generation-ci.txt'];
const failures = [];
for (const file of requirementFiles) {
  const text = await readFile(file, 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.replace(/#.*/, '').trim();
    if (!value) continue;
    if (/^(?:-r|--|git\+|https?:)/i.test(value) || !/^[A-Za-z0-9_.-]+(?:\[[^\]]+\])?(?:[<>=!~].+)?$/.test(value)) failures.push(`${file}:${index + 1}: unsupported or unpinned requirement syntax`);
  }
}
const state = await inspectPython();
if (!state.validVersion) failures.push(`Python 3.12 or 3.13 required; found ${state.version ?? 'unavailable'}`);
if (!state.pip) failures.push('pip check failed or pip is unavailable');
if (state.error) failures.push(state.error);
for (const packageInfo of state.packages) if (!packageInfo.optional && (packageInfo.missing || !packageInfo.satisfies)) failures.push(`${packageInfo.name}: requirement ${packageInfo.requirement} is not satisfied`);
const missingOptional = state.packages.filter(packageInfo => packageInfo.optional && (packageInfo.missing || !packageInfo.satisfies)).map(packageInfo => packageInfo.name);
console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', python: state.version, packages: state.packages, missingOptional, failures}, null, 2));
if (failures.length) process.exitCode = 1;
