#!/usr/bin/env node
/**
 * Generates PULSE.md — status of metapackage submodules (badges for tests, release, security, coverage, lint)
 * and a Mermaid dependency graph of @diplodoc/* packages.
 * Run from repo root: node scripts/pulse.js [> PULSE.md]
 *
 * Table columns vary by section: packages/extensions include coverage and lint; devops has lint, no coverage;
 * actions have no tests/lint. The "lint" column uses shields.io Dynamic JSON badge to show @diplodoc/lint
 * version from each repo's package-lock.json. Override any cell with '-' via row config.
 * At the end, a Mermaid flowchart is appended from the Nx project graph (`nx graph --file`), including only @diplodoc/* nodes and edges between them.
 * In Mermaid, "flowchart" is the right type for directed dependency graphs (nodes + arrows); orientation TB = top-to-bottom.
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ORG = 'diplodoc-platform';
const BRANCH = 'master';

/** JSONPath for @diplodoc/lint version in package-lock.json (npm lockfile v3) */
const LINT_VERSION_QUERY = "$['packages']['node_modules/@diplodoc/lint'].version";

/** Short ids of packages to hide in the dependency graph (e.g. lint/tsconfig — everyone depends on them). */
const DEPENDS_GRAPH_HIDE = new Set(['lint', 'tsconfig']);

/** Exclude example/demo packages from the graph (shortId ending with -example). */
const DEPENDS_GRAPH_HIDE_EXAMPLE = true;

const SECTIONS = {
  packages: {
    columns: ['version', 'tests', 'release', 'security', 'coverage', 'infra'],
    versionBadge: 'npm',
    rows: [
      { path: 'packages/cli', repo: 'cli', npm: '@diplodoc/cli', coverage: 'sonar' },
      { path: 'packages/client', repo: 'client', npm: '@diplodoc/client' },
      { path: 'packages/components', repo: 'components', npm: '@diplodoc/components' },
      { path: 'packages/directive', repo: 'directive', npm: '@diplodoc/directive', coverage: 'sonar' },
      { path: 'packages/liquid', repo: 'liquid', npm: '@diplodoc/liquid', coverage: 'sonar' },
      { path: 'packages/sentenizer', repo: 'sentenizer', npm: '@diplodoc/sentenizer', coverage: 'sonar' },
      { path: 'packages/transform', repo: 'transform', npm: '@diplodoc/transform', coverage: 'sonar' },
      { path: 'packages/translation', repo: 'translation', npm: '@diplodoc/translation', coverage: 'sonar' },
      { path: 'packages/utils', repo: 'utils', npm: '@diplodoc/utils', coverage: 'sonar' },
      { path: 'packages/yfmlint', repo: 'yfmlint', npm: '@diplodoc/yfmlint', coverage: 'sonar' },
    ],
  },
  extensions: {
    columns: ['version', 'tests', 'release', 'security', 'coverage', 'infra'],
    versionBadge: 'npm',
    rows: [
      { path: 'extensions/algolia', repo: 'algolia-extension', npm: '@diplodoc/algolia-extension', coverage: 'sonar' },
      { path: 'extensions/color', repo: 'color-extension', npm: '@diplodoc/color-extension', coverage: 'sonar' },
      { path: 'extensions/cut', repo: 'cut-extension', npm: '@diplodoc/cut-extension', coverage: 'sonar' },
      { path: 'extensions/file', repo: 'file-extension', npm: '@diplodoc/file-extension', coverage: 'sonar' },
      { path: 'extensions/folding-headings', repo: 'folding-headings-extension', npm: '@diplodoc/folding-headings-extension', coverage: 'sonar' },
      { path: 'extensions/html', repo: 'html-extension', npm: '@diplodoc/html-extension', coverage: 'sonar' },
      { path: 'extensions/latex', repo: 'latex-extension', npm: '@diplodoc/latex-extension', coverage: 'sonar' },
      { path: 'extensions/mermaid', repo: 'mermaid-extension', npm: '@diplodoc/mermaid-extension', coverage: 'sonar' },
      { path: 'extensions/openapi', repo: 'openapi-extension', npm: '@diplodoc/openapi-extension', coverage: 'sonar' },
      { path: 'extensions/page-constructor', repo: 'page-constructor-extension', npm: '@diplodoc/page-constructor-extension', coverage: 'sonar' },
      { path: 'extensions/quote-link', repo: 'quote-link-extension', npm: '@diplodoc/quote-link-extension', coverage: 'sonar' },
      { path: 'extensions/search', repo: 'search-extension', npm: '@diplodoc/search-extension', coverage: 'sonar' },
      { path: 'extensions/tabs', repo: 'tabs-extension', npm: '@diplodoc/tabs-extension', coverage: 'sonar' },
    ],
  },
  devops: {
    columns: ['version', 'tests', 'release', 'security'],
    versionBadge: 'npm',
    rows: [
      { path: 'devops/babel-preset', repo: 'babel-preset', npm: '@diplodoc/babel-preset', tests: '-' },
      { path: 'devops/lint', repo: 'lint', npm: '@diplodoc/lint', lint: '-' },
      { path: 'devops/package-template', repo: 'package-template', version: '-', tests: '-', release: '-' },
      { path: 'devops/testpack', repo: 'testpack', npm: '@diplodoc/testpack' },
      { path: 'devops/tsconfig', repo: 'tsconfig', npm: '@diplodoc/tsconfig', tests: '-' },
    ],
  },
  actions: {
    columns: ['version', 'release', 'security'],
    versionBadge: 'github-release',
    rows: [
      { path: 'actions/docs-build', repo: 'docs-build-action' },
      { path: 'actions/docs-clean', repo: 'docs-clean-action' },
      { path: 'actions/docs-message', repo: 'docs-message-action' },
      { path: 'actions/docs-release', repo: 'docs-release-action' },
      { path: 'actions/docs-upload', repo: 'docs-upload-action' },
    ],
  },
};

function link(href, text) {
  return `[${text}](${href})`;
}

function badge(imgUrl, linkUrl, alt = 'badge') {
  return link(linkUrl, `![${alt}](${imgUrl})`);
}

function cell(row, col, sectionConfig) {
  const override = row[col];
  if (override === '-') return '-';

  const repo = row.repo;
  const base = `https://github.com/${ORG}/${repo}`;

  switch (col) {
    case 'version': {
      if (sectionConfig.versionBadge === 'github-release') {
        return badge(
          `https://img.shields.io/github/v/release/${ORG}/${repo}`,
          `${base}/releases`,
          'version'
        );
      }
      const npmName = row.npm;
      if (!npmName) return '-';
      return badge(
        `https://img.shields.io/npm/v/${npmName}`,
        `${base}/releases`,
        'version'
      );
    }
    case 'tests':
      return badge(
        `https://github.com/${ORG}/${repo}/actions/workflows/tests.yml/badge.svg?branch=${BRANCH}`,
        `https://github.com/${ORG}/${repo}/actions/workflows/tests.yml`,
        'tests'
      );
    case 'release':
      return badge(
        `https://github.com/${ORG}/${repo}/actions/workflows/release.yml/badge.svg`,
        `https://github.com/${ORG}/${repo}/actions/workflows/release.yml`,
        'release'
      );
    case 'security':
      return badge(
        `https://github.com/${ORG}/${repo}/actions/workflows/security.yml/badge.svg?branch=${BRANCH}`,
        `https://github.com/${ORG}/${repo}/actions/workflows/security.yml`,
        'security'
      );
    case 'coverage': {
      if (row.coverage === 'sonar') {
        return badge(
          `https://sonarcloud.io/api/project_badges/measure?project=${ORG}_${repo}&metric=coverage`,
          `https://sonarcloud.io/summary/overall?id=${ORG}_${repo}`,
          'Coverage'
        );
      }
      return '-';
    }
    case 'infra': {
      const lockUrl = `https://raw.githubusercontent.com/${ORG}/${repo}/${BRANCH}/package-lock.json`;
      const params = new URLSearchParams({
        url: lockUrl,
        query: LINT_VERSION_QUERY,
        label: 'infra',
        prefix: 'v',
      });
      const imgUrl = `https://img.shields.io/badge/dynamic/json?${params.toString()}`;
      return badge(imgUrl, `https://github.com/${ORG}/lint/releases`, 'lint');
    }
    default:
      return '-';
  }
}

function tableHeader(columns) {
  const heads = ['Submodule', ...columns];
  const sep = heads.map((_, i) => (i === 0 ? '-----------' : ':-------:'));
  return ['| ' + heads.join(' | ') + ' |', '|' + sep.join('|') + '|'].join('\n');
}

function tableRow(row, columns, sectionConfig) {
  const linkText = link(`https://github.com/${ORG}/${row.repo}`, row.path);
  const cells = [linkText, ...columns.map((col) => cell(row, col, sectionConfig))];
  return '| ' + cells.join(' | ') + ' |';
}

function renderSection(name, sectionConfig, isLast = false) {
  const lines = [`## ${name}`, '', tableHeader(sectionConfig.columns)];
  for (const row of sectionConfig.rows) {
    lines.push(tableRow(row, sectionConfig.columns, sectionConfig));
  }
  if (!isLast) {
    lines.push('---', '');
  }
  return lines.join('\n');
}

/** Short id for Mermaid node: @diplodoc/foo-extension → foo-extension */
function shortId(name) {
  return name.startsWith('@diplodoc/') ? name.slice('@diplodoc/'.length) : name;
}

/** Run `nx graph --file` and return the graph object (same shape as nx.js graph()). */
function getNxGraph() {
  const file = resolve(process.cwd(), 'graph.json');
  try {
    execSync(`npx nx graph --file=${file}`, { stdio: 'pipe', cwd: process.cwd() });
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data.graph;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

/**
 * Build Mermaid diagram from Nx project graph (only @diplodoc/* nodes and edges between them).
 * Excludes packages in DEPENDS_GRAPH_HIDE. Prod: solid (-->), dev: dotted (-.->).
 */
function renderDepsGraph() {
  let nxGraph;
  try {
    nxGraph = getNxGraph();
  } catch {
    return '';
  }
  const { nodes = {}, dependencies = [] } = nxGraph;
  const cwd = process.cwd();

  const nodeIdToPkg = {};
  const nodeIdToRoot = {};
  for (const [id, node] of Object.entries(nodes)) {
    const root = node?.data?.root;
    if (!root) continue;
    nodeIdToRoot[id] = root;
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, root, 'package.json'), 'utf8'));
      if (pkg.name) nodeIdToPkg[id] = pkg.name;
    } catch {
      if (id.startsWith('@diplodoc/')) nodeIdToPkg[id] = id;
    }
  }

  /** For a project (node id), return { deps: Set(pkg names), devDeps: Set(pkg names) } from its package.json. */
  function getDepsByType(sourceNodeId) {
    const root = nodeIdToRoot[sourceNodeId];
    if (!root) return { deps: new Set(), devDeps: new Set() };
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, root, 'package.json'), 'utf8'));
      return {
        deps: new Set(Object.keys(pkg.dependencies || {})),
        devDeps: new Set(Object.keys(pkg.devDependencies || {})),
      };
    } catch {
      return { deps: new Set(), devDeps: new Set() };
    }
  }

  const diplodoc = new Set(Object.values(nodeIdToPkg).filter((n) => n.startsWith('@diplodoc/')));
  const depList = Array.isArray(dependencies)
    ? dependencies
    : Object.values(dependencies).flat();

  const edges = [];
  const outDegree = {};
  const inDegree = {};
  const sourceDepsCache = {};
  for (const dep of depList) {
    const source = nodeIdToPkg[dep.source];
    const target = nodeIdToPkg[dep.target];
    if (!source || !target || !diplodoc.has(source) || !diplodoc.has(target)) continue;
    const from = shortId(source);
    const to = shortId(target);
    if (DEPENDS_GRAPH_HIDE.has(from) || DEPENDS_GRAPH_HIDE.has(to)) continue;
    if (DEPENDS_GRAPH_HIDE_EXAMPLE && (from.endsWith('-example') || to.endsWith('-example'))) continue;
    if (!sourceDepsCache[dep.source]) sourceDepsCache[dep.source] = getDepsByType(dep.source);
    const { deps, devDeps } = sourceDepsCache[dep.source];
    const targetPkgName = nodeIdToPkg[dep.target];
    const isDev = devDeps.has(targetPkgName);
    edges.push({ from, to, isDev });
    outDegree[from] = (outDegree[from] || 0) + 1;
    inDegree[to] = (inDegree[to] || 0) + 1;
  }
  if (edges.length === 0) return '';

  const visible = new Set();
  for (const e of edges) {
    visible.add(e.from);
    visible.add(e.to);
  }
  const sortedNodes = [...visible].sort();

  const mermaidId = (s) => (s.match(/^[a-zA-Z_][a-zA-Z0-9_-]*$/) ? s : `"${s}"`);
  const nodeLabel = (sid) => `${mermaidId(sid)}["${sid}"]`;

  const edgeLine = (e) => (e.isDev ? `${e.from} -.-> ${e.to}` : `${e.from} --> ${e.to}`);

  const repoByShortId = {};
  for (const section of Object.values(SECTIONS)) {
    for (const row of section.rows || []) {
      if (row.npm) repoByShortId[shortId(row.npm)] = row.repo;
    }
  }

  const clickLines = sortedNodes
    .filter((sid) => repoByShortId[sid])
    .map((sid) => `  click ${mermaidId(sid)} href "https://github.com/${ORG}/${repoByShortId[sid]}"`);

  const lines = [
    '%%{ init: { "flowchart": { "curve": "stepAfter", "defaultRenderer": "elk" } } }%%',
    'flowchart LR',
    ...sortedNodes.map((sid) => '  ' + nodeLabel(sid)),
    ...edges.map((e) => '  ' + edgeLine(e)),
    ...clickLines,
  ];

  const hideParts = [...DEPENDS_GRAPH_HIDE].sort();
  if (DEPENDS_GRAPH_HIDE_EXAMPLE) hideParts.push('*-example');
  const hideNote = hideParts.length > 0 ? ` Hidden: ${hideParts.join(', ')}.` : '';

  return [
    '## Dependency graph (@diplodoc packages)',
    '',
    `Generated from Nx project graph (\`nx graph --file\`). **Orientation:** top to bottom (\`flowchart TB\`).`,
    '',
    '```mermaid',
    lines.join('\n'),
    '```',
    '',
  ].join('\n');
}

const header = `# Pulse — status of submodules (master)

Status badges for workflows created from [@diplodoc/lint](devops/lint) scaffolding (\`lint init\` / \`lint update\`).  
Branch: **master**. Release badge reflects last run (event: \`release: published\` or \`workflow_dispatch\`).

Workflows: [tests](.github/workflows/tests.yml) · [release](.github/workflows/release.yml) · [security](.github/workflows/security.yml)

**Version:** npm latest for packages/extensions/devops (link → GitHub Releases); GitHub release for actions.

---
`;

const sectionNames = Object.keys(SECTIONS);
const body = sectionNames
  .map((name, i) => renderSection(name, SECTIONS[name], i === sectionNames.length - 1))
  .join('\n');

const depsGraph = renderDepsGraph();
const out = header + '\n' + body.trimEnd() + (depsGraph ? '\n\n---\n\n' + depsGraph : '') + '\n';

writeFileSync(join(process.cwd(), 'PULSE.md'), out, 'utf8');
