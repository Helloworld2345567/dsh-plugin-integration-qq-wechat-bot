import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', '.codex', '.runtime', 'node_modules', 'dist', 'outputs', 'coverage']);
const markdown = [];
async function walk(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (ignored.has(entry.name) || entry.name === 'fix_plan.md') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) markdown.push(full);
  }
}
await walk(root);
const failures = [];
const linkPattern = /(?<!!?)\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+)(?:\s+[^)]*)?)\)/g;
for (const file of markdown) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    const raw = (match[1] ?? match[2]).trim();
    if (!raw || /^(?:https?:|mailto:|data:|#)/i.test(raw)) continue;
    const target = raw.split('#', 1)[0].split('?', 1)[0];
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    let exists = false;
    try { await stat(resolved); exists = true; } catch {}
    if (!exists) failures.push(`${path.relative(root, file)} -> ${raw}`);
  }
}
const workflows = [];
async function findYaml(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await findYaml(full);
    else if (entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name)) workflows.push(full);
  }
}
await findYaml(path.join(root, '.github'));
const {parse} = await import('yaml');
for (const file of workflows) {
  try { parse(await readFile(file, 'utf8')); }
  catch (error) { failures.push(`${path.relative(root, file)}: invalid YAML (${error.message})`); }
}
console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', markdownFiles: markdown.length, yamlFiles: workflows.length, failures}, null, 2));
if (failures.length) process.exitCode = 1;
