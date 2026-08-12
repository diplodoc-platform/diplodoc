#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildUpdatePlan,
  classifyDependency,
  compareVersions,
  dispatchFailureHint,
  isUpdatableSection,
  rangeAllowsLatest,
  renderDriftTable,
  updateDepsPackagesInput,
} from './drift.js';

test('compareVersions orders releases and prereleases', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('^1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
});

test('rangeAllowsLatest understands caret, tilde and pins', () => {
  assert.equal(rangeAllowsLatest('^1.2.3', '1.9.0'), true);
  assert.equal(rangeAllowsLatest('^1.2.3', '2.0.0'), false);
  assert.equal(rangeAllowsLatest('~1.2.3', '1.2.9'), true);
  assert.equal(rangeAllowsLatest('~1.2.3', '1.3.0'), false);
  assert.equal(rangeAllowsLatest('1.2.3', '1.2.3'), true);
  assert.equal(rangeAllowsLatest('1.2.3', '1.2.4'), false);
  assert.equal(rangeAllowsLatest('^0.3.1', '0.3.9'), true);
  assert.equal(rangeAllowsLatest('^0.3.1', '0.4.0'), false);
});

test('classifyDependency flags only versions behind latest', () => {
  assert.deepEqual(classifyDependency('^1.2.3', '1.4.0'), {
    comparable: true,
    stale: true,
    allowsLatest: true,
  });
  assert.deepEqual(classifyDependency('^2.0.0', '2.0.0'), {
    comparable: true,
    stale: false,
    allowsLatest: true,
  });
  assert.deepEqual(classifyDependency('workspace:*', '1.0.0'), {
    comparable: false,
    stale: false,
    allowsLatest: false,
  });
});

test('buildUpdatePlan groups by repo and skips peerDependencies', () => {
  const plan = buildUpdatePlan([
    { repo: 'cli', name: '@diplodoc/utils', section: 'dependencies' },
    { repo: 'cli', name: '@diplodoc/testpack', section: 'devDependencies' },
    { repo: 'cli', name: '@diplodoc/utils', section: 'dependencies' },
    { repo: 'transform', name: '@diplodoc/utils', section: 'peerDependencies' },
  ]);

  assert.deepEqual(plan, [
    {
      repo: 'cli',
      packages: [
        { name: '@diplodoc/utils', version: 'latest', section: 'dependencies' },
        { name: '@diplodoc/testpack', version: 'latest', section: 'devDependencies' },
      ],
    },
  ]);
  assert.equal(isUpdatableSection('peerDependencies'), false);
});

test('updateDepsPackagesInput marks devDependencies with the dev: prefix', () => {
  const input = updateDepsPackagesInput({
    repo: 'cli',
    packages: [
      { name: '@diplodoc/utils', section: 'dependencies' },
      { name: '@diplodoc/testpack', section: 'devDependencies' },
    ],
  });
  assert.equal(input, '@diplodoc/utils,dev:@diplodoc/testpack');
});

test('renderDriftTable renders rows or an empty note', () => {
  assert.match(renderDriftTable([]), /No stale/);
  const table = renderDriftTable([
    {
      repo: 'cli',
      name: '@diplodoc/utils',
      section: 'devDependencies',
      declared: '^1.0.0',
      latest: '1.2.0',
      allowsLatest: true,
    },
  ]);
  assert.match(table, /\| `cli` \| `@diplodoc\/utils` \| dev \| `\^1\.0\.0` \| `1\.2\.0` \| yes \|/);
});

test('dispatchFailureHint blames the reused branch, not the scaffolding', () => {
  const reused = dispatchFailureHint({
    message: 'Unexpected inputs provided: ["create_pr"]',
    branch: 'drift-rt-11',
    branchReused: true,
    targetBranch: 'master',
  });
  assert.match(reused, /reused `drift-rt-11` branch predates/);
  assert.match(reused, /delete that branch or start a train with a new id/);
  assert.doesNotMatch(reused, /scaffolding/);
});

test('dispatchFailureHint blames the scaffolding for a freshly cut branch', () => {
  const fresh = dispatchFailureHint({
    message: 'Unexpected inputs provided: ["create_pr"]',
    branch: 'drift-rt-12',
    branchReused: false,
    targetBranch: 'master',
  });
  assert.match(fresh, /`master` in this repo still has an update-deps\.yml/);
  assert.match(fresh, /update its scaffolding/);
});

test('dispatchFailureHint stays silent for unrelated failures', () => {
  assert.equal(
    dispatchFailureHint({ message: 'HTTP 404: Not Found', branch: 'drift-rt-11', branchReused: true }),
    '',
  );
  assert.equal(dispatchFailureHint({ message: null, branch: 'b', branchReused: false }), '');
});
