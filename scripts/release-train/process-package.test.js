#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processPackage } from './process-package.js';
import { createPackageState } from './state.js';

const ENTRY = {
  repo: 'cli',
  npm: '@diplodoc/cli',
  featurePr: { number: 1, url: 'https://example.test/pr/1', headRefName: 'ts-upgrade' },
  merge_method: 'rebase',
  auto_approve_release: true,
};

function makeCtx({ pkg = createPackageState(ENTRY), publishedByNpm = {} } = {}) {
  const packages = [pkg];
  return {
    org: 'diplodoc-platform',
    token: 'token',
    approverToken: 'approver',
    config: {},
    defaults: {},
    trainId: 'rt-1',
    issue: { owner: 'diplodoc-platform', repo: 'diplodoc', number: 106 },
    branchName: null,
    targetBranch: 'master',
    publishedByNpm,
    updateLockfile: true,
    findPackage: (repo) => packages.find((p) => p.repo === repo),
    updatePackage: (repo, patch) => Object.assign(packages.find((p) => p.repo === repo), patch),
    persist: () => {},
    now: () => '2026-08-12T00:00:00.000Z',
  };
}

const never = (name) => () => assert.fail(`${name} must not be called`);

function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    getPr: () => ({ state: 'OPEN' }),
    mergePr: (...args) => calls.push(['mergePr', args]),
    bumpDownstreamDeps: (...args) => {
      calls.push(['bump', args]);
      return [{ repo: 'cli', bumped: true }];
    },
    waitForCiGreen: async () => {
      calls.push(['waitCi']);
      return { ci: { state: 'success' }, snapshots: { state: 'none' } };
    },
    waitForReleasePleaseMerge: async ({ onReleasePr }) => {
      calls.push(['waitRelease']);
      if (onReleasePr) {
        await onReleasePr({
          releasePr: { number: 9, url: 'https://example.test/pr/9' },
          pendingVersion: '2.0.0',
        });
      }
      return { releasePr: { number: 9, url: 'https://example.test/pr/9' }, merged: true };
    },
    readPackageVersionFromRepo: () => '2.0.0',
    waitForNpmPackage: async () => '2.0.0',
    ...overrides,
  };
  return { deps, calls };
}

test('happy path: bump, CI, merge, release, publish', async () => {
  const ctx = makeCtx({ publishedByNpm: { '@diplodoc/utils': '1.0.1' } });
  const { deps, calls } = makeDeps();

  await processPackage(ctx, ENTRY, deps);

  const pkg = ctx.findPackage('cli');
  assert.equal(pkg.status, 'done');
  assert.equal(pkg.npmVersion, '2.0.0');
  assert.equal(pkg.pendingVersion, '2.0.0');
  assert.deepEqual(pkg.bumpedDeps, { '@diplodoc/utils': '1.0.1' });
  assert.equal(ctx.publishedByNpm['@diplodoc/cli'], '2.0.0');
  assert.deepEqual(
    calls.map(([name]) => name),
    ['bump', 'waitCi', 'mergePr', 'waitRelease'],
  );
});

test('already merged feature PR skips bump, CI wait and merge', async () => {
  const ctx = makeCtx();
  const { deps } = makeDeps({
    getPr: (owner, repo, number) => {
      assert.equal(number, 1);
      return { state: 'MERGED' };
    },
    bumpDownstreamDeps: never('bumpDownstreamDeps'),
    waitForCiGreen: never('waitForCiGreen'),
    mergePr: never('mergePr'),
  });

  await processPackage(ctx, ENTRY, deps);

  assert.equal(ctx.findPackage('cli').status, 'done');
  assert.equal(ctx.publishedByNpm['@diplodoc/cli'], '2.0.0');
});

test('already merged release PR skips the release wait', async () => {
  const pkg = createPackageState(ENTRY);
  pkg.releasePr = { number: 9, url: 'https://example.test/pr/9' };
  const ctx = makeCtx({ pkg });
  const { deps } = makeDeps({
    getPr: (owner, repo, number) => ({ state: number === 9 ? 'MERGED' : 'OPEN' }),
    waitForReleasePleaseMerge: never('waitForReleasePleaseMerge'),
  });

  await processPackage(ctx, ENTRY, deps);

  assert.equal(ctx.findPackage('cli').status, 'done');
  assert.equal(ctx.findPackage('cli').npmVersion, '2.0.0');
});

test('closed feature PR fails the package explicitly', async () => {
  const ctx = makeCtx();
  const { deps } = makeDeps({ getPr: () => ({ state: 'CLOSED' }) });

  await assert.rejects(
    () => processPackage(ctx, ENTRY, deps),
    /Feature PR diplodoc-platform\/cli#1 was closed without merge/,
  );
});

test('closed release PR fails the package explicitly', async () => {
  const pkg = createPackageState(ENTRY);
  pkg.releasePr = { number: 9, url: 'https://example.test/pr/9' };
  const ctx = makeCtx({ pkg });
  const { deps } = makeDeps({
    getPr: (owner, repo, number) => ({ state: number === 9 ? 'CLOSED' : 'MERGED' }),
  });

  await assert.rejects(
    () => processPackage(ctx, ENTRY, deps),
    /Release PR diplodoc-platform\/cli#9 was closed without merge/,
  );
});

test('manual release timeout surfaces waiting_release_review', async () => {
  const ctx = makeCtx();
  const { deps } = makeDeps({
    waitForReleasePleaseMerge: async () => ({
      releasePr: { number: 9, url: 'https://example.test/pr/9' },
      merged: false,
      waitingManual: true,
    }),
  });

  await assert.rejects(
    () => processPackage(ctx, ENTRY, deps),
    /Timed out waiting for manual release PR merge/,
  );
  assert.equal(ctx.findPackage('cli').status, 'waiting_release_review');
});

test('no accumulated versions means no bump commit', async () => {
  const ctx = makeCtx({ publishedByNpm: {} });
  const { deps, calls } = makeDeps({ bumpDownstreamDeps: never('bumpDownstreamDeps') });

  await processPackage(ctx, ENTRY, deps);

  assert.deepEqual(
    calls.map(([name]) => name),
    ['waitCi', 'mergePr', 'waitRelease'],
  );
});
