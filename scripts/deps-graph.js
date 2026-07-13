#!/usr/bin/env node
/**
 * Builds @diplodoc/* dependency graph from package.json files (not Nx semver inference).
 * Writes deps-graph.json and exposes helpers for release-train and pulse.
 *
 * Run: node scripts/deps-graph.js [--check]
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { loadYaml } from './release-train/yaml-loader.js';

const ROOT = process.cwd();
const ORG = 'diplodoc-platform';
const OUTPUT = join(ROOT, 'deps-graph.json');

/** Graph nodes excluded from visualization and release-train targets. */
export const GRAPH_HIDE = new Set(['infra', 'package-template']);

export const SCAN_ROOTS = ['packages', 'extensions', 'devops'];

export function shortId(npmName) {
  return npmName.startsWith('@diplodoc/') ? npmName.slice('@diplodoc/'.length) : npmName;
}

function parseGitmodules() {
  const path = join(ROOT, '.gitmodules');
  if (!existsSync(path)) return {};
  const map = {};
  const text = readFileSync(path, 'utf8');
  let currentPath = null;
  for (const line of text.split('\n')) {
    const pathMatch = line.match(/^\s*path\s*=\s*(.+)/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      continue;
    }
    const urlMatch = line.match(/^\s*url\s*=\s*.+\/(.+?)(?:\.git)?\s*$/);
    if (urlMatch && currentPath) {
      map[currentPath] = urlMatch[1].trim();
    }
  }
  return map;
}

function repoFromPath(relPath, gitmodules) {
  if (gitmodules[relPath]) return gitmodules[relPath];
  const parts = relPath.split('/');
  if (parts[0] === 'packages' && parts[1]) return parts[1];
  if (parts[0] === 'extensions' && parts[1]) {
    const name = parts[1];
    return name.includes('-extension') ? name : `${name}-extension`;
  }
  if (parts[0] === 'devops' && parts[1]) return parts[1];
  return basename(relPath);
}

function isHiddenNode(short) {
  if (GRAPH_HIDE.has(short)) return true;
  if (short.endsWith('-example')) return true;
  return false;
}

function listPackageDirs() {
  const dirs = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(ROOT, root);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const rel = `${root}/${name}`;
      const pkgJson = join(abs, name, 'package.json');
      if (!statSync(join(abs, name)).isDirectory()) continue;
      if (!existsSync(pkgJson)) continue;
      if (name.endsWith('-example') || name === 'example') continue;
      dirs.push(rel);
    }
  }
  return dirs.sort();
}

function readPkg(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath, 'package.json'), 'utf8'));
}

function collectDiplodocDeps(pkg) {
  const names = new Set();
  for (const key of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[key] || {})) {
      if (dep.startsWith('@diplodoc/')) names.add(dep);
    }
  }
  const peers = pkg.peerDependencies || {};
  const peerMeta = pkg.peerDependenciesMeta || {};
  for (const [dep, _range] of Object.entries(peers)) {
    if (!dep.startsWith('@diplodoc/')) continue;
    if (peerMeta[dep]?.optional) continue;
    names.add(dep);
  }
  return names;
}

function edgeType(pkg, targetNpm) {
  if (pkg.dependencies?.[targetNpm]) return 'prod';
  if (pkg.devDependencies?.[targetNpm]) return 'dev';
  if (pkg.peerDependencies?.[targetNpm]) return 'peer';
  return 'prod';
}

/** npm ↔ repo slug maps from release-train.yml (single source of truth). */
export function loadReleaseTrainRepoMaps(path = join(ROOT, 'release-train.yml')) {
  const cfg = loadReleaseTrainConfig(path);
  const repoToNpm = new Map();
  const npmToRepo = new Map();
  for (const [slug, repoCfg] of Object.entries(cfg?.repos || {})) {
    if (!repoCfg?.npm) continue;
    repoToNpm.set(slug, repoCfg.npm);
    npmToRepo.set(repoCfg.npm, slug);
  }
  return { repoToNpm, npmToRepo };
}

function resolvePackageIdentity(relPath, pkg, gitmodules, releaseTrain) {
  const pathRepo = repoFromPath(relPath, gitmodules);
  const { repoToNpm, npmToRepo } = releaseTrain;

  let npm;
  if (pkg.name?.startsWith('@diplodoc/')) {
    npm = pkg.name;
  } else if (repoToNpm.has(pathRepo)) {
    npm = repoToNpm.get(pathRepo);
  } else {
    return null;
  }

  const repo = npmToRepo.get(npm) || pathRepo;
  return { npm, repo, short: shortId(npm) };
}

export function buildDepsGraph(options = {}) {
  const { includeHidden = false } = options;
  const gitmodules = parseGitmodules();
  const releaseTrain = loadReleaseTrainRepoMaps();
  const dirs = listPackageDirs();
  const npmToNode = new Map();

  for (const relPath of dirs) {
    let pkg;
    try {
      pkg = readPkg(relPath);
    } catch {
      continue;
    }
    const identity = resolvePackageIdentity(relPath, pkg, gitmodules, releaseTrain);
    if (!identity) continue;
    const { npm, repo, short } = identity;
    if (!includeHidden && isHiddenNode(short)) continue;
    npmToNode.set(npm, {
      npm,
      shortId: short,
      repo,
      path: relPath,
    });
  }

  const edges = [];
  for (const relPath of dirs) {
    let pkg;
    try {
      pkg = readPkg(relPath);
    } catch {
      continue;
    }
    const fromIdentity = resolvePackageIdentity(relPath, pkg, gitmodules, releaseTrain);
    if (!fromIdentity || !npmToNode.has(fromIdentity.npm)) continue;
    const fromNpm = fromIdentity.npm;
    const fromShort = shortId(fromNpm);
    if (!includeHidden && isHiddenNode(fromShort)) continue;

    for (const depNpm of collectDiplodocDeps(pkg)) {
      if (!npmToNode.has(depNpm)) continue;
      const toShort = shortId(depNpm);
      if (!includeHidden && isHiddenNode(toShort)) continue;
      edges.push({
        from: fromNpm,
        to: depNpm,
        fromShort,
        toShort,
        type: edgeType(pkg, depNpm),
      });
    }
  }

  const topoOrder = topologicalSort(
    [...npmToNode.values()].map((n) => n.repo),
    edges,
    npmToNode,
  );

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...npmToNode.values()].sort((a, b) => a.npm.localeCompare(b.npm)),
    edges: edges.sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    ),
    topoOrder,
  };
}

function topologicalSort(repoOrder, edges, npmToNode) {
  const repoByNpm = new Map([...npmToNode.entries()].map(([npm, n]) => [npm, n.repo]));
  const nodes = new Set([...npmToNode.values()].map((n) => n.repo));
  const adj = new Map();
  const inDeg = new Map();

  for (const repo of nodes) {
    adj.set(repo, new Set());
    inDeg.set(repo, 0);
  }

  for (const e of edges) {
    const fromRepo = repoByNpm.get(e.from);
    const toRepo = repoByNpm.get(e.to);
    if (!fromRepo || !toRepo || fromRepo === toRepo) continue;
    if (!adj.get(toRepo).has(fromRepo)) {
      adj.get(toRepo).add(fromRepo);
      inDeg.set(fromRepo, (inDeg.get(fromRepo) || 0) + 1);
    }
  }

  const queue = [...nodes].filter((r) => inDeg.get(r) === 0).sort();
  const result = [];
  while (queue.length) {
    const n = queue.shift();
    result.push(n);
    for (const dep of [...(adj.get(n) || [])].sort()) {
      inDeg.set(dep, inDeg.get(dep) - 1);
      if (inDeg.get(dep) === 0) queue.push(dep);
      queue.sort();
    }
  }

  if (result.length !== nodes.size) {
    const stuck = [...nodes].filter((r) => !result.includes(r)).sort();
    throw new Error(`Dependency cycle detected among: ${stuck.join(', ')}`);
  }

  return result;
}

/** Topo order restricted to a subset of repos (preserves full-graph order). */
export function topoSortSubset(repos, graph = buildDepsGraph()) {
  const set = new Set(repos);
  return graph.topoOrder.filter((r) => set.has(r));
}

/** @deprecated use topoSortSubset — kept for upstream expansion checks */
export function topoOrderForRepos(repos, graph = buildDepsGraph()) {
  const selected = new Set(repos);
  const repoByNpm = new Map(graph.nodes.map((n) => [n.npm, n.repo]));
  const upstream = new Set();

  let changed = true;
  while (changed) {
    changed = false;
    for (const e of graph.edges) {
      const fromRepo = repoByNpm.get(e.from);
      const toRepo = repoByNpm.get(e.to);
      if (!fromRepo || !toRepo) continue;
      if (selected.has(fromRepo) && !selected.has(toRepo)) {
        selected.add(toRepo);
        upstream.add(toRepo);
        changed = true;
      }
    }
  }

  return graph.topoOrder.filter((r) => selected.has(r));
}

export function renderMermaid(graph, options = {}) {
  const { org = ORG } = options;
  const repoByShort = Object.fromEntries(graph.nodes.map((n) => [n.shortId, n.repo]));
  const visible = new Set();
  for (const e of graph.edges) {
    visible.add(e.fromShort);
    visible.add(e.toShort);
  }
  const sortedNodes = [...visible].sort();
  const mermaidId = (s) => (s.match(/^[a-zA-Z_][a-zA-Z0-9_-]*$/) ? s : `"${s}"`);
  const nodeLabel = (sid) => `${mermaidId(sid)}["${sid}"]`;
  const edgeLine = (e) => (e.type === 'dev' ? `${e.fromShort} -.-> ${e.toShort}` : `${e.fromShort} --> ${e.toShort}`);
  const clickLines = sortedNodes
    .filter((sid) => repoByShort[sid])
    .map((sid) => `  click ${mermaidId(sid)} href "https://github.com/${org}/${repoByShort[sid]}"`);

  return [
    '%%{ init: { "flowchart": { "defaultRenderer": "elk" } } }%%',
    'flowchart LR',
    ...sortedNodes.map((sid) => '  ' + nodeLabel(sid)),
    ...graph.edges.map((e) => '  ' + edgeLine(e)),
    ...clickLines,
  ].join('\n');
}

export function loadReleaseTrainConfig(path = join(ROOT, 'release-train.yml')) {
  if (!existsSync(path)) return null;
  return loadYaml(path);
}

function main() {
  const check = process.argv.includes('--check');
  const graph = buildDepsGraph();
  const json = JSON.stringify(graph, null, 2) + '\n';

  if (check) {
    if (!existsSync(OUTPUT)) {
      console.error('deps-graph.json missing — run node scripts/deps-graph.js');
      process.exit(1);
    }
    const existing = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    const fresh = buildDepsGraph();
    const strip = (g) => JSON.stringify({ nodes: g.nodes, edges: g.edges, topoOrder: g.topoOrder });
    if (strip(existing) !== strip(fresh)) {
      console.error('deps-graph.json is out of date — run node scripts/deps-graph.js');
      process.exit(1);
    }
    console.log('deps-graph.json is up to date');
    return;
  }

  writeFileSync(OUTPUT, json);
  console.log(`Wrote ${OUTPUT} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
}

if (process.argv[1]?.endsWith('deps-graph.js')) {
  main();
}
