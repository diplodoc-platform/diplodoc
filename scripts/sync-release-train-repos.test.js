#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  mergeReposFromGitmodules,
  orderReposBySection,
  parseGitmodules,
  sectionForSlug,
  serializeReleaseTrain,
  syncReleaseTrainRepos,
} from './sync-release-train-repos.js';

const SAMPLE_GITMODULES = `
[submodule "packages/utils"]
	path = packages/utils
[submodule "extensions/color"]
	path = extensions/color
[submodule "devops/testpack"]
	path = devops/testpack
[submodule "devops/infra"]
	path = devops/infra
`;

const SAMPLE_CONFIG = `
defaults:
  org: diplodoc-platform
capabilities:
  update_lockfile:
    default: true
repos:
  # === packages (critical: manual release PR review) ===
  utils:
    npm: '@diplodoc/utils'
    auto_approve_release: false
`;

test('parseGitmodules categorizes paths', () => {
  const gm = parseGitmodules(SAMPLE_GITMODULES);
  assert.deepEqual(gm.packages, ['utils']);
  assert.deepEqual(gm.extensions, ['color-extension']);
  assert.deepEqual(gm.devops, ['testpack']);
});

test('mergeReposFromGitmodules adds only missing slugs', () => {
  const gm = parseGitmodules(SAMPLE_GITMODULES);
  const repos = {
    utils: { npm: '@diplodoc/utils', auto_approve_release: false },
  };
  const added = mergeReposFromGitmodules(repos, gm);
  assert.deepEqual(added.sort(), ['color-extension', 'testpack']);
  assert.equal(repos.utils.auto_approve_release, false);
  assert.equal(repos['color-extension'].npm, '@diplodoc/color-extension');
});

test('serializeReleaseTrain keeps sections and existing overrides', () => {
  const gm = parseGitmodules(SAMPLE_GITMODULES);
  const repos = {
    utils: { npm: '@diplodoc/utils', auto_approve_release: false },
    'color-extension': { npm: '@diplodoc/color-extension' },
    testpack: { npm: '@diplodoc/testpack' },
  };
  const yaml = serializeReleaseTrain(
    {
      defaults: { org: 'diplodoc-platform' },
      capabilities: { update_lockfile: { default: true } },
      repos,
    },
    gm,
    ['testpack'],
  );

  const utilsIdx = yaml.indexOf('  utils:');
  const extHeaderIdx = yaml.indexOf('# === extensions ===');
  const testpackIdx = yaml.indexOf('  testpack:');
  assert.ok(utilsIdx < extHeaderIdx, 'packages section before extensions');
  assert.ok(extHeaderIdx < testpackIdx, 'extensions before devops testpack');
  assert.match(yaml, /auto_approve_release: false/);
});

test('syncReleaseTrainRepos writes new repo into extensions section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-sync-'));
  const gitmodulesPath = join(dir, '.gitmodules');
  const configPath = join(dir, 'release-train.yml');

  writeFileSync(gitmodulesPath, SAMPLE_GITMODULES);
  writeFileSync(configPath, SAMPLE_CONFIG);

  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const result = syncReleaseTrainRepos({ gitmodulesPath, configPath });
    assert.deepEqual(result.added.sort(), ['color-extension', 'testpack']);
    const out = readFileSync(configPath, 'utf8');
    const colorIdx = out.indexOf('  color-extension:');
    const extHeaderIdx = out.indexOf('# === extensions ===');
    const devopsHeaderIdx = out.indexOf('# === devops (publishable) ===');
    assert.ok(extHeaderIdx < colorIdx, 'new extension stays in extensions section');
    assert.ok(colorIdx < devopsHeaderIdx, 'devops section follows extensions');
    assert.equal(sectionForSlug('legacy', { packages: [], extensions: [], devops: [] }), 'other');
  } finally {
    process.chdir(cwd);
  }
});
