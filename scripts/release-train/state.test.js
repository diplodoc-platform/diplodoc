#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initState,
  isPackageCompleted,
  mergePlanWithRestoredState,
  restoreTrainState,
  serializeTrainState,
} from './state.js';

function samplePlan() {
  return {
    trainId: 'rt-1',
    dryRun: false,
    branchName: null,
    packages: [
      { repo: 'utils', npm: '@diplodoc/utils', featurePr: { number: 1, url: 'u1', headRefName: 'a' } },
      { repo: 'cli', npm: '@diplodoc/cli', featurePr: { number: 2, url: 'u2', headRefName: 'b' } },
    ],
  };
}

test('isPackageCompleted covers done and released only', () => {
  assert.equal(isPackageCompleted({ status: 'done' }), true);
  assert.equal(isPackageCompleted({ status: 'released' }), true);
  assert.equal(isPackageCompleted({ status: 'failed' }), false);
  assert.equal(isPackageCompleted(null), false);
});

test('serializeTrainState captures participants and published versions', () => {
  const state = initState(samplePlan());
  state.packages[0].status = 'done';

  const rtState = serializeTrainState({
    trainId: 'rt-1',
    state,
    publishedByNpm: { '@diplodoc/utils': '1.2.3' },
    issue: { owner: 'o', repo: 'r', number: 5, url: 'url' },
  });

  assert.equal(rtState.version, 1);
  assert.equal(rtState.trainId, 'rt-1');
  assert.deepEqual(rtState.participants.map((p) => p.repo), ['utils', 'cli']);
  assert.equal(rtState.participants[0].prNumber, 1);
  assert.equal(rtState.publishedByNpm['@diplodoc/utils'], '1.2.3');
  assert.equal(rtState.state.packages[0].status, 'done');
});

test('restoreTrainState reads back a serialized state', () => {
  const state = initState(samplePlan());
  state.packages[0].status = 'released';
  const rtState = serializeTrainState({
    trainId: 'rt-1',
    state,
    publishedByNpm: { '@diplodoc/utils': '1.0.0' },
  });

  const restored = restoreTrainState(rtState);
  assert.equal(restored.trainId, 'rt-1');
  assert.equal(restored.packages[0].status, 'released');
  assert.deepEqual(restored.publishedByNpm, { '@diplodoc/utils': '1.0.0' });
});

test('restoreTrainState rejects values tampered with in the issue body', () => {
  const restored = restoreTrainState({
    version: 1,
    trainId: 'rt-1',
    branchName: '--upload-pack=touch /tmp/pwned',
    publishedByNpm: { '@diplodoc/utils': '1.0.0', evil: 'latest' },
    state: {
      packages: [
        {
          repo: 'cli',
          npm: '@diplodoc/cli',
          status: 'done',
          npmVersion: '$(id)',
          featurePr: { number: '7; rm -rf /', headRefName: '--exec=evil', url: 'javascript:alert(1)' },
        },
        { repo: '../../etc/passwd', status: 'done' },
      ],
    },
  });

  assert.equal(restored.branchName, null);
  assert.deepEqual(restored.publishedByNpm, { '@diplodoc/utils': '1.0.0' });
  assert.deepEqual(restored.packages.map((p) => p.repo), ['cli']);
  assert.equal(restored.packages[0].featurePr, null);
  assert.equal(restored.packages[0].npmVersion, null);
});

test('restoreTrainState downgrades unknown statuses to queued', () => {
  const restored = restoreTrainState({
    version: 1,
    state: { packages: [{ repo: 'cli', status: 'definitely-done' }] },
  });
  assert.equal(restored.packages[0].status, 'queued');
});

test('restoreTrainState ignores unknown schema versions', () => {
  assert.equal(restoreTrainState({ version: 99, trainId: 'rt-1' }), null);
  assert.equal(restoreTrainState(null), null);
});

test('mergePlanWithRestoredState keeps progress and queues new packages', () => {
  const restored = restoreTrainState(
    serializeTrainState({
      trainId: 'rt-1',
      state: {
        startedAt: '2020-01-01T00:00:00.000Z',
        packages: [
          {
            repo: 'utils',
            npm: '@diplodoc/utils',
            status: 'released',
            npmVersion: '1.2.3',
            featurePr: { number: 1, url: 'u1', headRefName: 'a' },
            releasePr: { number: 9, url: 'r9' },
          },
        ],
      },
      publishedByNpm: { '@diplodoc/utils': '1.2.3' },
    }),
  );

  const merged = mergePlanWithRestoredState(samplePlan(), restored);

  assert.equal(merged.startedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(merged.packages[0].status, 'released');
  assert.equal(merged.packages[0].npmVersion, '1.2.3');
  assert.equal(merged.packages[0].releasePr.number, 9);
  assert.equal(merged.packages[1].status, 'queued');
});

test('mergePlanWithRestoredState without restored state is a plain init', () => {
  const merged = mergePlanWithRestoredState(samplePlan(), null);
  assert.deepEqual(merged.packages.map((p) => p.status), ['queued', 'queued']);
});
