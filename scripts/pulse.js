#!/usr/bin/env node
/**
 * Generates PULSE.md — status of metapackage submodules (badges for tests, release, security, coverage, lint).
 * Run from repo root: node scripts/pulse.js [> PULSE.md]
 *
 * Table columns vary by section: packages/extensions include coverage and lint; devops has lint, no coverage;
 * actions have no tests/lint. The "lint" column uses shields.io Dynamic JSON badge to show @diplodoc/lint
 * version from each repo's package-lock.json. Override any cell with '-' via row config.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORG = 'diplodoc-platform';
const BRANCH = 'master';

/** JSONPath for @diplodoc/lint version in package-lock.json (npm lockfile v3) */
const LINT_VERSION_QUERY = "$['packages']['node_modules/@diplodoc/lint'].version";

const SECTIONS = {
  packages: {
    columns: ['version', 'tests', 'release', 'security', 'coverage', 'infra'],
    versionBadge: 'npm',
    rows: [
      { path: 'packages/cli', repo: 'cli', npm: '@diplodoc/cli', coverage: 'sonar' },
      { path: 'packages/client', repo: 'client', npm: '@diplodoc/client' },
      { path: 'packages/components', repo: 'components', npm: '@diplodoc/components' },
      { path: 'packages/directive', repo: 'directive', npm: '@diplodoc/directive' },
      { path: 'packages/gh-docs', repo: 'gh-docs', npm: '@diplodoc/gh-docs' },
      { path: 'packages/liquid', repo: 'liquid', npm: '@diplodoc/liquid' },
      { path: 'packages/sentenizer', repo: 'sentenizer', npm: '@diplodoc/sentenizer' },
      { path: 'packages/transform', repo: 'transform', npm: '@diplodoc/transform' },
      { path: 'packages/translation', repo: 'translation', npm: '@diplodoc/translation' },
      { path: 'packages/utils', repo: 'utils', npm: '@diplodoc/utils' },
      { path: 'packages/yfmlint', repo: 'yfmlint', npm: '@diplodoc/yfmlint' },
    ],
  },
  extensions: {
    columns: ['version', 'tests', 'release', 'security', 'coverage', 'infra'],
    versionBadge: 'npm',
    rows: [
      { path: 'extensions/algolia', repo: 'algolia-extension', npm: '@diplodoc/algolia-extension' },
      { path: 'extensions/color', repo: 'color-extension', npm: '@diplodoc/color-extension' },
      { path: 'extensions/cut', repo: 'cut-extension', npm: '@diplodoc/cut-extension' },
      { path: 'extensions/file', repo: 'file-extension', npm: '@diplodoc/file-extension' },
      { path: 'extensions/folding-headings', repo: 'folding-headings-extension', npm: '@diplodoc/folding-headings-extension' },
      { path: 'extensions/html', repo: 'html-extension', npm: '@diplodoc/html-extension' },
      { path: 'extensions/latex', repo: 'latex-extension', npm: '@diplodoc/latex-extension' },
      { path: 'extensions/mermaid', repo: 'mermaid-extension', npm: '@diplodoc/mermaid-extension' },
      { path: 'extensions/openapi', repo: 'openapi-extension', npm: '@diplodoc/openapi-extension' },
      { path: 'extensions/page-constructor', repo: 'page-constructor-extension', npm: '@diplodoc/page-constructor-extension' },
      { path: 'extensions/quote-link', repo: 'quote-link-extension', npm: '@diplodoc/quote-link-extension' },
      { path: 'extensions/search', repo: 'search-extension', npm: '@diplodoc/search-extension' },
      { path: 'extensions/tabs', repo: 'tabs-extension', npm: '@diplodoc/tabs-extension' },
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
      { path: 'actions/docs-build-static', repo: 'docs-build-static-action' },
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
          `https://sonarcloud.io/summary/new_code?id=${ORG}_${repo}`,
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

const out = header + '\n' + body.trimEnd() + '\n';

writeFileSync(join(process.cwd(), 'PULSE.md'), out, 'utf8');
