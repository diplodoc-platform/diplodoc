import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { github, inspect, inventory, readGitmodules, scan } from './submodule-discovery.js';
import { loadYaml } from './release-train/yaml-loader.js';

const TARGET = 'diplodoc-platform/diplodoc';
const OWNER = TARGET.split('/')[0];
const API = 'repos/' + TARGET;
const REMOTE = 'https://github.com/' + TARGET + '.git';
const WORKSPACES = new Set(['packages', 'extensions', 'devops']);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' }).trim();
}

export function candidateBranch(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Missing GitHub repository ID');
  return 'codex/submodule-' + id;
}

function marker(id) {
  return '.github/submodule-requests/' + id + '.md';
}

export function validatePlacement(slug, path, { files, pkg }) {
  const repo = slug.split('/')[1];
  if (!path || !/^[a-z\d][a-z\d_.-]*(\/[a-z\d][a-z\d_.-]*)?$/.test(path)) {
    throw new Error('Invalid submodule path: ' + path);
  }
  if (path === repo) return false;

  const [section, name] = path.split('/');
  if (section === 'actions' && name === repo.replace(/-action$/, '') && (files.has('action.yml') || files.has('action.yaml'))) return false;

  const expected = section === 'extensions' && repo.endsWith('-extension')
    ? repo.slice(0, -'-extension'.length) : repo;
  const correctSection = WORKSPACES.has(section) && (section !== 'extensions' || repo.endsWith('-extension'));
  if (!correctSection || name !== expected || pkg?.name !== '@diplodoc/' + repo || pkg.private || pkg.workspaces) {
    throw new Error('Path is incompatible with the repository manifest and metapackage conventions: ' + path);
  }
  return true;
}

export function parsePlacementComment(body) {
  return /^\/submodule-path +([a-z\d][a-z\d_.-]*(?:\/[a-z\d][a-z\d_.-]*)?)\s*$/.exec(body)?.[1];
}

export function pendingCandidates(candidates, lookup) {
  return candidates.filter((candidate) => {
    const previous = lookup(candidateBranch(candidate.id));
    if (!previous.length) return true;
    console.log('Existing PR for %s: %s (%s)', candidate.slug, previous[0].html_url, previous[0].state);
    return false;
  });
}

function pullRequests(branch) {
  return github(API + '/pulls?state=all&head=' + encodeURIComponent(OWNER + ':' + branch));
}

function runNode(cwd, script, ...args) {
  execFileSync(process.execPath, [join(SCRIPT_DIR, script), ...args], { cwd, stdio: 'inherit' });
}

function pin(candidate) {
  const full_name = candidate.slug;
  const ref = github('repos/' + full_name + '/commits/' + encodeURIComponent(candidate.branch)).sha;
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error('Invalid commit SHA for ' + full_name);
  return { ref, ...inspect({ full_name }, ref) };
}

function seedWorkspaceManifests(worktree, modules) {
  for (const { path } of modules) {
    if (!WORKSPACES.has(path.split('/')[0])) continue;
    const source = join(ROOT, path, 'package.json');
    if (!existsSync(source)) throw new Error('Initialize workspace submodule first: ' + path);
    mkdirSync(join(worktree, path), { recursive: true });
    copyFileSync(source, join(worktree, path, 'package.json'));
  }
}

function addReleaseTrainEntry(worktree, section, name, npmName) {
  const path = join(worktree, 'release-train.yml');
  if (loadYaml(path).repos[name]) return;
  const content = readFileSync(path, 'utf8');
  const start = content.indexOf('  # === ' + section + ' ');
  if (start === -1) throw new Error('Missing release-train section for ' + section);
  const next = content.indexOf('\n  # === ', start);
  const end = next === -1 ? content.length : next + 1;
  const entry = '  ' + name + ':\n    npm: \'' + npmName + '\'\n';
  const before = content.slice(0, end).trimEnd();
  writeFileSync(path, before + '\n' + entry + (next === -1 ? '' : '\n' + content.slice(end)));
}

function populate(worktree, candidate, path, modules) {
  const pinned = pin(candidate);
  const workspace = validatePlacement(candidate.slug, path, pinned);
  if (git(worktree, 'ls-files', '--', path)) throw new Error('Destination is already tracked: ' + path);
  const key = 'submodule.' + path;
  git(worktree, 'config', '-f', '.gitmodules', key + '.path', path);
  git(worktree, 'config', '-f', '.gitmodules', key + '.url', 'git@github.com:' + candidate.slug + '.git');
  git(worktree, 'add', '.gitmodules');
  git(worktree, 'update-index', '--add', '--cacheinfo', '160000,' + pinned.ref + ',' + path);

  if (workspace) {
    seedWorkspaceManifests(worktree, modules);
    mkdirSync(join(worktree, path), { recursive: true });
    writeFileSync(join(worktree, path, 'package.json'), JSON.stringify(pinned.pkg) + '\n');

    const env = { ...process.env };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit'], {
      cwd: worktree, env, stdio: 'inherit',
    });
    addReleaseTrainEntry(worktree, path.split('/')[0], candidate.slug.split('/')[1], pinned.pkg.name);
    runNode(worktree, 'deps-graph.js');
    runNode(worktree, 'sync-release-train-repos.js', '--check');
    runNode(worktree, 'deps-graph.js', '--check');
    runNode(worktree, 'pulse.js');
    git(worktree, 'add', '--', 'package-lock.json', 'release-train.yml', 'deps-graph.json', 'PULSE.md');
  }
  return pinned.ref;
}

function prepareCommit(base, candidate, path, modules) {
  const worktree = mkdtempSync(join(tmpdir(), 'diplodoc-onboarding-'));
  git(ROOT, 'worktree', 'add', '--detach', worktree, base);
  try {
    let sha;
    if (path) {
      sha = populate(worktree, candidate, path, modules);
    } else {
      const file = marker(candidate.id);
      mkdirSync(dirname(join(worktree, file)), { recursive: true });
      writeFileSync(join(worktree, file), 'Placement required for ' + candidate.slug + '.\n');
      git(worktree, 'add', '--', file);
    }
    git(worktree, 'diff', '--cached', '--check');
    git(worktree, '-c', 'user.name=Diplodoc automation',
      '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'chore: onboard ' + candidate.slug);
    return { commit: git(worktree, 'rev-parse', 'HEAD'), sha };
  } finally {
    git(ROOT, 'worktree', 'remove', '--force', worktree);
    rmSync(worktree, { force: true, recursive: true });
  }
}

function push(branch, commit, previous = '') {
  const ref = 'refs/heads/' + branch;
  git(ROOT, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
    'push', '--force-with-lease=' + ref + ':' + previous, REMOTE, commit + ':' + ref);
}

function description(candidate, path, sha) {
  const lines = ['Onboard [' + candidate.slug + '](https://github.com/' + candidate.slug + ').', ''];
  if (path && sha) {
    lines.push('Proposed path: ' + path + '.', 'Pinned default-branch commit: ' + sha + '.');
    lines.push('', 'Review the submodule pin and generated workspace changes before merging.');
  } else if (path) {
    lines.push('Review the staged submodule path, pin and workspace changes before merging.');
  } else {
    lines.push(candidate.reason + '.',
      '', 'Choose a destination by commenting /submodule-path packages/example as a maintainer.',
      'Keep this PR in draft until the workflow applies the selected path.');
  }
  return lines.join('\n');
}

function create(base, baseBranch, candidate, modules) {
  const branch = candidateBranch(candidate.id);
  const remote = git(ROOT, 'ls-remote', '--heads', REMOTE, 'refs/heads/' + branch);
  let sha;
  let path = candidate.path;
  if (remote) {
    const commit = remote.split('\t')[0];
    const existing = github(API + '/commits/' + commit);
    if (existing.commit.message !== 'chore: onboard ' + candidate.slug) {
      throw new Error('Automation branch belongs to another change: ' + branch);
    }
    if (existing.files.some(({ filename }) => filename === marker(candidate.id))) path = undefined;
  } else {
    const prepared = prepareCommit(base, candidate, path, modules);
    push(branch, prepared.commit);
    sha = prepared.sha;
  }

  const args = ['pr', 'create', '--repo', TARGET, '--base', baseBranch, '--head', branch,
    '--title', 'chore: onboard ' + candidate.slug.split('/')[1], '--body', description(candidate, path, sha)];
  if (!path) args.push('--draft');
  console.log('Created %s', execFileSync('gh', args, { encoding: 'utf8' }).trim());
}

function resolveComment(base, baseBranch, candidates, modules, event) {
  const path = parsePlacementComment(event.comment.body);
  if (!path || !event.issue.pull_request) return;
  const pr = github(API + '/pulls/' + Number(event.issue.number));
  if (pr.state !== 'open' || !pr.draft || pr.base.ref !== baseBranch || pr.head.repo?.full_name !== TARGET) return;

  const candidate = candidates.find(({ id }) => candidateBranch(id) === pr.head.ref);
  if (!candidate) return;
  const permission = github(API + '/collaborators/' + encodeURIComponent(event.comment.user.login) + '/permission');
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) return;

  const changes = github('--paginate', '--slurp', API + '/pulls/' + pr.number + '/files?per_page=100').flat();
  if (changes.length !== 1 || changes[0].filename !== marker(candidate.id) || changes[0].status !== 'added') {
    throw new Error('Placement can only replace an untouched request draft');
  }
  const prepared = prepareCommit(base, candidate, path, modules);
  push(pr.head.ref, prepared.commit, pr.head.sha);
  github('--method', 'PATCH', API + '/pulls/' + pr.number, '-f',
    'body=' + pr.body + '\n\n' + description(candidate, path, prepared.sha));
  console.log('Applied %s in %s', path, pr.html_url);
}

function main() {
  const { values } = parseArgs({
    options: { candidate: { type: 'string' }, 'event-file': { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  const event = values['event-file'] ? JSON.parse(readFileSync(values['event-file'], 'utf8')) : null;
  if (event && values['dry-run']) throw new Error('Choose either a comment event or a dry run');
  const baseBranch = github(API).default_branch;
  const base = github(API + '/branches/' + encodeURIComponent(baseBranch)).commit.sha;
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid metapackage default-branch commit');
  git(ROOT, 'diff', '--quiet', base, '--', '.gitmodules', '.gitmodules-ignore', 'package.json', 'package-lock.json', 'release-train.yml');

  const repos = inventory();
  const modules = readGitmodules();
  const { additions, manual } = scan(repos);
  const publicSlugs = new Set(repos.filter(({ visibility }) => visibility === 'public').map(({ full_name }) => full_name.toLowerCase()));
  const candidates = [...additions, ...manual.filter(({ slug }) => publicSlugs.has(slug)).map((candidate) => ({ ...candidate, path: undefined }))];

  if (event) return resolveComment(base, baseBranch, candidates, modules, event);
  const selected = candidates.filter(({ slug }) => !values.candidate || slug === OWNER + '/' + values.candidate);
  for (const candidate of pendingCandidates(selected, pullRequests)) {
    if (values['dry-run']) {
      console.log('Would open %s for %s → %s', candidate.path ? 'a PR' : 'a draft PR', candidate.slug, candidate.path || 'placement required');
    } else {
      create(base, baseBranch, candidate, modules);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
