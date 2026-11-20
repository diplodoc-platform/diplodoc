import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const OWNER = 'diplodoc-platform';

function githubSlug(value = '') {
  const slug = value
    .replace(/^(https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)/i, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
  return /^[a-z\d_.-]+\/[a-z\d_.-]+$/.test(slug) ? slug : null;
}

export function parseIgnore(contents) {
  const ignored = new Set();
  for (const line of contents.split(/\r?\n/)) {
    const value = line.split('#', 1)[0].trim();
    if (!value) continue;
    const slug = githubSlug(value.includes('/') ? value : OWNER + '/' + value);
    if (!slug) throw new Error('Invalid .gitmodules-ignore entry: ' + value);
    ignored.add(slug);
  }
  return ignored;
}

export function readGitmodules() {
  const modules = new Map();
  const config = execFileSync('git', [
    'config', '--file', '.gitmodules', '--null', '--get-regexp', '^submodule\\..*\\.(path|url)$',
  ], { encoding: 'utf8' });
  for (const entry of config.split('\0').filter(Boolean)) {
    const [, name, key, value] = /^submodule\.(.+)\.(path|url)\n([\s\S]*)$/.exec(entry);
    if (!modules.has(name)) modules.set(name, {});
    modules.get(name)[key] = value;
  }
  return [...modules.values()].map(({ path, url }) => ({ path, slug: githubSlug(url) }));
}

export function suggestPath(name, { files, pkg }) {
  if (files.has('action.yml') || files.has('action.yaml')) {
    return { path: 'actions/' + name.replace(/-action$/, ''), reason: 'Root GitHub Action manifest' };
  }
  if (!pkg && files.has('.claude-plugin') && files.has('skills')) {
    return { path: name, reason: 'Agent skills collection' };
  }
  if (pkg?.private || pkg?.workspaces) {
    return { reason: 'Private npm package or nested npm workspace' };
  }
  if (pkg?.name !== '@diplodoc/' + name) {
    return { reason: 'No matching @diplodoc npm package in the repository root' };
  }
  if (name.endsWith('-extension')) {
    return { path: 'extensions/' + name.slice(0, -'-extension'.length), reason: 'Extension package ' + pkg.name };
  }
  if (/(?:-config|-template|-action)$/.test(name)) {
    return { reason: 'Infrastructure or template repository needs a placement decision' };
  }
  return { path: 'packages/' + name, reason: 'npm package ' + pkg.name };
}

export function discover(repos, modules, ignored, inspect, pathExists = existsSync) {
  const linked = new Map(modules.filter(({ slug }) => slug).map((entry) => [entry.slug, entry]));
  const occupied = new Set(modules.map(({ path }) => path));
  const seen = new Set();
  const inactive = [];
  const decisions = [];

  for (const repo of repos) {
    const slug = githubSlug(repo.full_name);
    if (!slug?.startsWith(OWNER + '/') || seen.has(slug)) {
      throw new Error('Unexpected or duplicate repository in inventory: ' + repo.full_name);
    }
    seen.add(slug);

    if (linked.has(slug)) {
      if (repo.archived || repo.disabled) inactive.push(linked.get(slug));
      continue;
    }
    if (slug === OWNER + '/diplodoc' || ignored.has(slug) || repo.archived || repo.disabled) continue;

    const name = slug.split('/')[1];
    let reason;
    if (repo.visibility !== 'public') reason = 'Repository is not public';
    else if (repo.fork || repo.is_template) reason = 'Fork or template';
    else if (repo.size === 0) reason = 'Repository has no indexed content';

    decisions.push({ slug, id: repo.id, branch: repo.default_branch, ...(reason ? { reason } : suggestPath(name, inspect(repo))) });
  }

  const counts = new Map();
  for (const { path } of decisions) {
    if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  const additions = [];
  const manual = [];
  for (const decision of decisions.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const { path } = decision;
    if (!path) manual.push(decision);
    else if (occupied.has(path) || pathExists(path) || counts.get(path) > 1) {
      manual.push({ ...decision, reason: 'Destination ' + path + ' is occupied or ambiguous' });
    } else additions.push(decision);
  }

  const absent = [...linked.values()].filter(({ slug }) => slug.startsWith(OWNER + '/') && !seen.has(slug));
  return { additions, manual, inactive, absent };
}

export function github(...args) {
  return JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }));
}

export function inspect(repo, ref = repo.default_branch) {
  const base = 'repos/' + repo.full_name + '/git/';
  const tree = github(base + 'trees/' + encodeURIComponent(ref));
  if (tree.truncated || !Array.isArray(tree.tree)) {
    throw new Error('Incomplete repository tree: ' + repo.full_name);
  }

  const files = new Set(tree.tree.map(({ path }) => path));
  const manifest = tree.tree.find(({ path }) => path === 'package.json');
  if (!manifest) return { files };
  if (manifest.type !== 'blob' || !/^[a-f0-9]{40}$/.test(manifest.sha)) {
    throw new Error('Invalid root manifest: ' + repo.full_name);
  }

  const blob = github(base + 'blobs/' + manifest.sha);
  if (blob.encoding !== 'base64') throw new Error('Unreadable manifest: ' + repo.full_name);
  return { files, pkg: JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')) };
}

function printReport({ additions, manual, inactive, absent }, count) {
  console.log('## Diplodoc submodule discovery\n\nScanned %d GitHub repositories.', count);
  const sections = [
    ['Proposed additions', additions.map(({ slug, path, reason }) => slug + ' → ' + path + ' · ' + reason)],
    ['Needs review', manual.map(({ slug, reason }) => slug + ' · ' + reason)],
    ['Linked but archived or disabled', inactive.map(({ slug, path }) => slug + ' at ' + path)],
    ['Linked but absent from this inventory', absent.map(({ slug, path }) => slug + ' at ' + path)],
  ];
  for (const [title, lines] of sections) {
    console.log('\n### %s (%d)\n', title, lines.length);
    for (const line of lines) console.log('- %s', line);
  }
}

export function inventory(includePrivate = false) {
  const visibility = includePrivate ? 'all' : 'public';
  const pages = github('--paginate', '--slurp', 'orgs/' + OWNER + '/repos?type=' + visibility + '&per_page=100');
  if (!Array.isArray(pages) || !pages.length || !pages.every(Array.isArray) || !pages[0].length) {
    throw new Error('GitHub returned an empty or invalid repository inventory');
  }

  return pages.flat();
}

export function scan(repos) {
  return discover(repos, readGitmodules(), parseIgnore(readFileSync('.gitmodules-ignore', 'utf8')), inspect);
}

function main() {
  const { values } = parseArgs({
    options: {
      'include-private': { type: 'boolean' },
      'write-plan': { type: 'boolean' },
    },
  });
  const repos = inventory(values['include-private']);
  const result = scan(repos);
  printReport(result, repos.length);

  if (values['write-plan']) {
    const lines = result.additions.map(({ slug, path }) => '+ ' + path + ' ' + path + ' git@github.com:' + slug + '.git');
    writeFileSync('submodules.conf', ['# Format: +/- [name] [path] [URL]', ...lines, ''].join('\n'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
