import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const canonicalRoot = await realpath(root);
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

function slugify(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}
function headingSlugs(text) {
  const slugs = new Set();
  for (const match of text.matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    const base = slugify(match[2]);
    if (!base) continue;
    let slug = base;
    let suffix = 1;
    while (slugs.has(slug)) slug = `${base}-${suffix++}`;
    slugs.add(slug);
  }
  return slugs;
}
function localTarget(raw) {
  const withoutTitle = raw.trim().replace(/^<|>$/g, '');
  const hash = withoutTitle.indexOf('#');
  const query = withoutTitle.indexOf('?');
  const cut = [hash, query].filter(index => index >= 0).sort((a, b) => a - b)[0];
  const target = cut === undefined ? withoutTitle : withoutTitle.slice(0, cut);
  const fragment = hash < 0 ? undefined : withoutTitle.slice(hash + 1).split('?', 1)[0];
  return {target: decodeURIComponent(target), fragment: fragment ? decodeURIComponent(fragment).toLowerCase() : undefined};
}

const failures = [];
const linkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))/g;
const rootDocuments = new Set(['README', 'CONTRIBUTING', 'SECURITY', 'CODE_OF_CONDUCT', 'CHANGELOG', 'SUPPORT', 'THIRD_PARTY_NOTICES']);
function languageCounterpart(relative) {
  if (relative.startsWith('docs/en/')) return `docs/${relative.slice('docs/en/'.length)}`;
  if (relative.startsWith('docs/')) return `docs/en/${relative.slice('docs/'.length)}`;
  const rootDocument = /^([^/]+?)(\.en)?\.md$/.exec(relative);
  if (rootDocument && rootDocuments.has(rootDocument[1])) return `${rootDocument[1]}${rootDocument[2] ? '' : '.en'}.md`;
  if (/^packages\/[^/]+\/README(?:\.en)?\.md$/.test(relative)) return relative.endsWith('.en.md') ? relative.replace(/\.en\.md$/, '.md') : relative.replace(/\.md$/, '.en.md');
}
const markdownPaths = new Set(markdown.map(file => path.relative(root, file).replaceAll('\\', '/')));
let languagePairs = 0;
for (const file of markdown) {
  const text = await readFile(file, 'utf8');
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const counterpart = languageCounterpart(relative);
  if (counterpart) {
    if (!markdownPaths.has(counterpart)) failures.push(`${relative}: missing language counterpart ${counterpart}`);
    else {
      const header = text.split(/\r?\n/).slice(0, 8).join('\n');
      const linked = [...header.matchAll(linkPattern)].some(match => {
        try {
          const target = localTarget(match[1] ?? match[2]).target;
          return path.relative(root, path.resolve(path.dirname(file), target)).replaceAll('\\', '/') === counterpart;
        } catch { return false; }
      });
      if (!header.includes('简体中文') || !header.includes('English') || !linked) failures.push(`${relative}: missing top language navigation to ${counterpart}`);
      if (relative < counterpart) languagePairs++;
    }
  }
  const slugs = headingSlugs(text);
  for (const match of text.matchAll(linkPattern)) {
    const raw = (match[1] ?? match[2]).trim();
    if (!raw || /^(?:https?:|wss?:|mailto:|data:|javascript:)/i.test(raw)) continue;
    let parsed;
    try { parsed = localTarget(raw); } catch { failures.push(`${path.relative(root, file)} -> ${raw}: invalid URL encoding`); continue; }
    if (!parsed.target) {
      if (parsed.fragment && !slugs.has(parsed.fragment)) failures.push(`${path.relative(root, file)} -> ${raw}: missing fragment #${parsed.fragment}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), parsed.target);
    const repositoryRelative = path.relative(root, resolved);
    if (repositoryRelative.startsWith('..') || path.isAbsolute(repositoryRelative)) {
      failures.push(`${path.relative(root, file)} -> ${raw}: target escapes repository`);
      continue;
    }
    let exists = false;
    try { exists = (await stat(resolved)).isFile() || (await stat(resolved)).isDirectory(); } catch {}
    if (!exists) {
      failures.push(`${path.relative(root, file)} -> ${raw}: missing target`);
      continue;
    }
    try {
      const canonicalTarget = await realpath(resolved);
      const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
      if (canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative)) {
        failures.push(`${path.relative(root, file)} -> ${raw}: target escapes repository through a link`);
        continue;
      }
    } catch {
      failures.push(`${path.relative(root, file)} -> ${raw}: target cannot be resolved safely`);
      continue;
    }
    if (parsed.fragment) {
      let fragmentFile = resolved;
      try {
        if ((await stat(fragmentFile)).isDirectory()) {
          const readme = path.join(fragmentFile, 'README.md');
          if ((await stat(readme)).isFile()) fragmentFile = readme;
        }
        const targetText = await readFile(fragmentFile, 'utf8');
        if (!headingSlugs(targetText).has(parsed.fragment)) failures.push(`${path.relative(root, file)} -> ${raw}: missing fragment #${parsed.fragment}`);
      } catch { failures.push(`${path.relative(root, file)} -> ${raw}: cannot inspect fragment #${parsed.fragment}`); }
    }
  }
  // V3 persona migration is intentionally not a supported contract. Scan every
  // published Markdown source, but allow explicit negative/V4-only statements.
  const migrationClaim=/preserved\s+when\s+migrating\s+v3\s+personas?\s+to\s+v4|migrat(?:e|ing|ion)\s+v3(?:\s+personas?)?\s+(?:to|into)\s+v4|v3\s*(?:to|→)\s*v4.{0,40}migrat\w*|v3.{0,20}(?:到|至|→).{0,20}v4.{0,20}(?:迁移|升级|转换)|v3.{0,40}(?:迁移到|升级到|转换为|回退到).{0,20}v4|(?:迁移|升级|转换).{0,20}v3.{0,20}(?:到|至|为).{0,20}v4/gis;
  for(const claim of text.matchAll(migrationClaim)){
    const before=text.slice(Math.max(0,(claim.index??0)-40),claim.index??0);
    if(!/(?:does\s+not|do\s+not|not\s+supported|unsupported|不承诺|不支持|不会|不再|禁止|无)\s*.{0,30}$/is.test(before))failures.push(`${path.relative(root, file)}: unsupported V3-to-V4 persona migration promise`);
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
try { await findYaml(path.join(root, '.github')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const {parse} = await import('yaml');
for (const file of workflows) {
  const text = await readFile(file, 'utf8');
  let document;
  try { document = parse(text); }
  catch (error) { failures.push(`${path.relative(root, file)}: invalid YAML (${error.message})`); continue; }
  if (path.relative(root, file).replaceAll('\\', '/') === '.github/workflows/ci.yml') {
    if (!document || typeof document !== 'object' || Array.isArray(document)) failures.push('.github/workflows/ci.yml: root must be an object');
    else {
      if (document.env?.NODE_VERSION !== '24') failures.push('.github/workflows/ci.yml: Node version contract changed');
      const pythonVersions = Object.values(document.jobs ?? {}).flatMap(job => job.steps ?? [])
        .filter(step => step.uses?.startsWith('actions/setup-python@')).map(step => String(step.with?.['python-version']));
      for (const version of ['3.12', '3.13']) if (!pythonVersions.includes(version)) failures.push(`.github/workflows/ci.yml: Python ${version} coverage missing`);
      if (!/ffmpeg\s+-version[\s\S]*ffprobe\s+-version/m.test(text)) failures.push('.github/workflows/ci.yml: ffmpeg/ffprobe verification missing');
    }
  }
}

console.log(JSON.stringify({status: failures.length ? 'FAIL' : 'PASS', markdownFiles: markdown.length, languagePairs, yamlFiles: workflows.length, failures}, null, 2));
if (failures.length) process.exitCode = 1;
