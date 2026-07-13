#!/usr/bin/env node
/**
 * Sync release-train.yml repos from .gitmodules.
 * Adds missing repos into the correct section; never removes existing entries.
 *
 * Run: node scripts/sync-release-train-repos.js [--check]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dumpYaml, loadYaml } from './release-train/yaml-loader.js';

const ROOT = process.cwd();
const GITMODULES = join(ROOT, '.gitmodules');
const CONFIG_PATH = join(ROOT, 'release-train.yml');

/** Section order in repos: — keep in sync when adding new categories. */
export const REPO_SECTIONS = [
  {
    id: 'packages',
    header: '  # === packages (critical: manual release PR review) ===',
  },
  {
    id: 'extensions',
    header: '  # === extensions ===',
  },
  {
    id: 'devops',
    header: '  # === devops (publishable) ===',
  },
  {
    id: 'other',
    header: '  # === other (not mapped in .gitmodules) ===',
  },
];

const DEVOPS_SKIP = new Set(['lint', 'infra', 'package-template']);

/** @returns {{ packages: string[], extensions: string[], devops: string[] }} */
export function parseGitmodules(text) {
  const packages = new Set();
  const extensions = new Set();
  const devops = new Set();
  let currentPath = null;

  for (const line of text.split('\n')) {
    const pathMatch = line.match(/^\s*path\s*=\s*(.+)/);
    if (pathMatch) {
      currentPath = pathMatch[1].trim();
      continue;
    }
    if (!currentPath) continue;

    const [root, name] = currentPath.split('/');
    if (root === 'packages' && name) packages.add(name);
    if (root === 'extensions' && name) extensions.add(`${name}-extension`);
    if (root === 'devops' && name && !DEVOPS_SKIP.has(name)) devops.add(name);
  }

  const sort = (arr) => [...arr].sort();
  return {
    packages: sort(packages),
    extensions: sort(extensions),
    devops: sort(devops),
  };
}

export function npmNameForSlug(slug, sectionId) {
  return `@diplodoc/${slug}`;
}

export function sectionForSlug(slug, gitmodules) {
  if (gitmodules.packages.includes(slug)) return 'packages';
  if (gitmodules.extensions.includes(slug)) return 'extensions';
  if (gitmodules.devops.includes(slug)) return 'devops';
  return 'other';
}

function defaultRepoEntry(slug, sectionId) {
  return { npm: npmNameForSlug(slug, sectionId) };
}

/**
 * Merge gitmodules into config.repos; return slugs added.
 * @param {Record<string, object>} repos
 */
export function mergeReposFromGitmodules(repos, gitmodules) {
  const added = [];
  const allSlugs = [
    ...gitmodules.packages.map((slug) => ({ slug, section: 'packages' })),
    ...gitmodules.extensions.map((slug) => ({ slug, section: 'extensions' })),
    ...gitmodules.devops.map((slug) => ({ slug, section: 'devops' })),
  ];

  for (const { slug, section } of allSlugs) {
    if (repos[slug]) continue;
    repos[slug] = defaultRepoEntry(slug, section);
    added.push(slug);
  }
  return added;
}

/** Preserve file order within each section; append newly added slugs at section tail. */
export function orderReposBySection(repos, gitmodules, addedSlugs = []) {
  const addedSet = new Set(addedSlugs);
  const existingOrder = Object.keys(repos);
  const buckets = Object.fromEntries(REPO_SECTIONS.map((s) => [s.id, []]));

  for (const slug of existingOrder) {
    if (addedSet.has(slug)) continue;
    buckets[sectionForSlug(slug, gitmodules)].push(slug);
  }

  for (const section of REPO_SECTIONS) {
    if (section.id === 'other') continue;
    for (const slug of gitmodules[section.id] || []) {
      if (!repos[slug] || buckets[section.id].includes(slug)) continue;
      buckets[section.id].push(slug);
    }
  }

  for (const slug of addedSlugs) {
    const section = sectionForSlug(slug, gitmodules);
    if (!buckets[section].includes(slug)) {
      buckets[section].push(slug);
    }
  }

  return buckets;
}

function yamlScalar(value) {
  if (typeof value === 'string') {
    if (/[\n:'"{}[\],&*#?|\-<>=!%@`]/.test(value) || value === '') {
      return JSON.stringify(value);
    }
    return `'${value}'`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  return String(value);
}

function dumpRepoEntry(slug, repoCfg) {
  const ordered = {};
  if (repoCfg.npm !== undefined) ordered.npm = repoCfg.npm;
  for (const key of Object.keys(repoCfg).sort()) {
    if (key === 'npm') continue;
    ordered[key] = repoCfg[key];
  }

  const body = dumpYaml(ordered, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false })
    .trimEnd()
    .split('\n')
    .map((line) => (line ? `    ${line}` : line));

  return [`  ${slug}:`, ...body].join('\n');
}

function dumpBlock(name, value) {
  const body = dumpYaml(value, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: false }).trimEnd();
  const lines = [`${name}:`];
  for (const line of body.split('\n')) {
    lines.push(line ? `  ${line}` : line);
  }
  return lines.join('\n');
}

export function serializeReleaseTrain(config, gitmodules, addedSlugs = []) {
  const buckets = orderReposBySection(config.repos, gitmodules, addedSlugs);
  const parts = [
    '# Release train configuration',
    '#',
    '# Orchestrates cross-package PR merges: shared branch name → topo merge →',
    '# release-please → npm → bump downstream deps → wait CI.',
    '#',
    '# See specs/release-train.md',
    '',
    dumpBlock('defaults', config.defaults || {}),
    '',
    dumpBlock('capabilities', config.capabilities || {}),
    '',
    'repos:',
  ];

  for (const section of REPO_SECTIONS) {
    const slugs = buckets[section.id];
    if (!slugs?.length) continue;
    parts.push(section.header);
    for (const slug of slugs) {
      parts.push(dumpRepoEntry(slug, config.repos[slug]));
    }
  }

  return `${parts.join('\n').replace(/\n+$/, '')}\n`;
}

export function syncReleaseTrainRepos(options = {}) {
  const {
    gitmodulesPath = GITMODULES,
    configPath = CONFIG_PATH,
    write = true,
  } = options;

  if (!existsSync(gitmodulesPath)) {
    throw new Error(`.gitmodules not found: ${gitmodulesPath}`);
  }
  if (!existsSync(configPath)) {
    throw new Error(`release-train.yml not found: ${configPath}`);
  }

  const gitmodules = parseGitmodules(readFileSync(gitmodulesPath, 'utf8'));
  const config = loadYaml(configPath) || {};
  config.repos = config.repos || {};

  const added = mergeReposFromGitmodules(config.repos, gitmodules);
  const prev = readFileSync(configPath, 'utf8');

  if (added.length === 0) {
    return { added, changed: false, content: prev };
  }

  const next = serializeReleaseTrain(config, gitmodules, added);

  if (write && next !== prev) {
    writeFileSync(configPath, next, 'utf8');
  }

  return { added, changed: next !== prev, content: next };
}

function main() {
  const check = process.argv.includes('--check');
  const result = syncReleaseTrainRepos({ write: !check });

  for (const slug of result.added) {
    console.log(`Added release-train repo: ${slug}`);
  }

  if (check) {
    if (result.changed) {
      console.error('release-train.yml is out of sync — run node scripts/sync-release-train-repos.js');
      process.exit(1);
    }
    console.log('release-train.yml is in sync');
    return;
  }

  if (!result.changed) {
    console.log('No release-train.yml changes');
  }
}

if (process.argv[1]?.endsWith('sync-release-train-repos.js')) {
  main();
}
