#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fmtFeaturePr,
  fmtMergeReadiness,
  fmtNpmVersion,
  fmtStatus,
  renderSummaryTable,
} from './render-summary.js';

test('fmtMergeReadiness maps mergeStateStatus to fixed flags', () => {
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'CLEAN' }), '✓');
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'UNSTABLE' }), '✓');
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'DIRTY' }), '✗ conflicts');
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'BEHIND' }), '✗ behind base');
  assert.equal(
    fmtMergeReadiness({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }),
    '✗ review required',
  );
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'BLOCKED' }), '✗ blocked');
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'UNKNOWN' }), '');
  assert.equal(fmtMergeReadiness(null), '');
  // Unexpected API values must not leak into the markdown.
  assert.equal(fmtMergeReadiness({ mergeStateStatus: 'BLOCKED', reviewDecision: '<evil>' }), '✗ blocked');
});

test('fmtFeaturePr appends the readiness flag to the PR link', () => {
  const pr = { number: 12, url: 'https://example.test/pr/12' };
  assert.equal(fmtFeaturePr(pr, { mergeStateStatus: 'CLEAN' }), '[#12](https://example.test/pr/12) ✓');
  assert.equal(fmtFeaturePr(pr, null), '[#12](https://example.test/pr/12)');
  assert.equal(fmtFeaturePr(null, null), '—');
});

test('fmtNpmVersion shows the pending release version before npm confirms', () => {
  assert.equal(fmtNpmVersion({ npmVersion: '1.2.3', pendingVersion: '1.2.3' }), '1.2.3');
  assert.equal(fmtNpmVersion({ npmVersion: null, pendingVersion: '1.2.3' }), '1.2.3 (pending)');
  assert.equal(fmtNpmVersion({ npmVersion: null, pendingVersion: null }), '—');
});

test('fmtStatus counts down the needs-human grace window', () => {
  const now = Date.parse('2026-08-12T12:00:00.000Z');
  const pkg = {
    status: 'needs_human',
    needsHuman: { deadline: '2026-08-12T12:17:30.000Z' },
  };
  assert.equal(fmtStatus(pkg, now), '⚠️ needs human — 18m left');
  assert.equal(fmtStatus({ ...pkg, needsHuman: { deadline: '2026-08-12T11:00:00.000Z' } }, now), '⚠️ needs human — 0m left');
  assert.equal(fmtStatus({ status: 'needs_human' }, now), 'needs_human');
  assert.equal(fmtStatus({ status: 'done' }, now), 'done');
  assert.equal(fmtStatus({ status: 'failed', error: 'boom' }, now), '❌ failed');
});

test('renderSummaryTable shows early CI failures with remaining check count', () => {
  const table = renderSummaryTable({
    packages: [
      {
        repo: 'cli',
        status: 'waiting_ci',
        featurePr: { number: 1, url: 'https://example.test/pr/1' },
        releasePr: null,
        npmVersion: null,
        pendingVersion: null,
        ci: {
          state: 'failure',
          url: 'https://example.test/check',
          failingCheck: 'Quality / linux',
          stillRunning: 2,
        },
        snapshots: { state: 'none' },
      },
    ],
  });
  assert.match(table, /❌ \[Quality \/ linux\]\(https:\/\/example\.test\/check\) \(2 still running\)/);
});
