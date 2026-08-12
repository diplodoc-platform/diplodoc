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

function makeCtx({ pkg = createPackageState(ENTRY), publishedByNpm = {}, defaults = {} } = {}) {
  const packages = [pkg];
  const notices = [];
  return {
    org: 'diplodoc-platform',
    token: 'token',
    approverToken: 'approver',
    config: {},
    defaults,
    notices,
    trainId: 'rt-1',
    issue: { owner: 'diplodoc-platform', repo: 'diplodoc', number: 106 },
    branchName: null,
    targetBranch: 'master',
    publishedByNpm,
    updateLockfile: true,
    findPackage: (repo) => packages.find((p) => p.repo === repo),
    updatePackage: (repo, patch) => Object.assign(packages.find((p) => p.repo === repo), patch),
    persist: () => {},
    notify: (body) => notices.push(body),
    now: () => '2026-08-12T00:00:00.000Z',
  };
}

const never = (name) => () => assert.fail(`${name} must not be called`);

function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    getPr: () => ({ state: 'OPEN' }),
    mergePr: (...args) => calls.push(['mergePr', args]),
    enableAutoMerge: (...args) => {
      calls.push(['autoMerge', args]);
      return true;
    },
    waitMs: async () => {
      calls.push(['waitMs']);
    },
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

test('a blocked merge arms auto-merge and waits for a human instead of failing', async () => {
  const ctx = makeCtx({ defaults: { merge_grace_min: 30, merge_grace_poll_s: 0 } });
  let mergeCalls = 0;
  let prState = 'OPEN';
  const { deps, calls } = makeDeps({
    mergePr: () => {
      mergeCalls += 1;
      throw new Error(
        'Command failed: gh pr merge 1\nX Pull request #1 is not mergeable: the base branch policy prohibits the merge.',
      );
    },
    getPr: (owner, repo, number) => {
      if (number === 9) return { state: 'MERGED' };
      const state = prState;
      // The human merges it while the train waits.
      prState = 'MERGED';
      return { state };
    },
  });

  await processPackage(ctx, ENTRY, deps);

  assert.equal(mergeCalls, 1, 'auto-merge armed, so no repeated direct merge');
  assert.ok(calls.some(([name]) => name === 'autoMerge'));
  assert.equal(ctx.findPackage('cli').status, 'done');
  assert.equal(ctx.findPackage('cli').needsHuman, null);
  assert.match(ctx.notices[0], /base branch policy prohibits the merge/);
});

test('a merge blocked past the grace window fails the package', async () => {
  const ctx = makeCtx({ defaults: { merge_grace_min: 0, merge_grace_poll_s: 0 } });
  const { deps } = makeDeps({
    mergePr: () => {
      throw new Error('X Pull request #1 is not mergeable: review required');
    },
  });

  await assert.rejects(
    () => processPackage(ctx, ENTRY, deps),
    /still cannot merge after 0m: .*review required/,
  );
  assert.equal(ctx.findPackage('cli').status, 'needs_human');
  assert.ok(ctx.findPackage('cli').needsHuman.deadline);
});

test('a non-blocking merge error still fails immediately', async () => {
  const ctx = makeCtx();
  const { deps } = makeDeps({
    mergePr: () => {
      throw new Error('HTTP 500: something exploded');
    },
    enableAutoMerge: never('enableAutoMerge'),
  });

  await assert.rejects(() => processPackage(ctx, ENTRY, deps), /something exploded/);
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
