#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyChecks } from './wait-ci.js';
import { releaseVersionFromTitle } from './wait-release-please.js';

const run = (name, status, conclusion = null) => ({
  name,
  status,
  conclusion,
  details_url: `https://example.test/${name}`,
});

test('classifyChecks reports failure as soon as any check completes red', () => {
  const result = classifyChecks({
    check_runs: [
      run('Quality / linux', 'completed', 'failure'),
      run('Quality / windows', 'in_progress'),
      run('Quality / macos', 'queued'),
    ],
  });
  assert.equal(result.state, 'failure');
  assert.equal(result.failing.name, 'Quality / linux');
  assert.equal(result.failing.url, 'https://example.test/Quality / linux');
  assert.equal(result.stillRunning, 2);
});

test('classifyChecks treats timed_out and action_required as failures', () => {
  for (const conclusion of ['timed_out', 'action_required', 'cancelled']) {
    const result = classifyChecks({ check_runs: [run('e2e', 'completed', conclusion)] });
    assert.equal(result.state, 'failure', conclusion);
    assert.equal(result.stillRunning, 0);
  }
});

test('classifyChecks stays pending while checks run without failures', () => {
  const result = classifyChecks({
    check_runs: [run('Quality', 'completed', 'success'), run('Coverage', 'in_progress')],
  });
  assert.equal(result.state, 'pending');
});

test('classifyChecks succeeds when every relevant check is green', () => {
  const result = classifyChecks({
    check_runs: [
      run('Quality', 'completed', 'success'),
      run('Coverage', 'completed', 'skipped'),
      run('Security', 'completed', 'neutral'),
    ],
  });
  assert.equal(result.state, 'success');
});

test('classifyChecks ignores bot workflows and empty check lists', () => {
  const bots = classifyChecks({
    check_runs: [
      run('auto-approve', 'completed', 'failure'),
      run('release-please', 'in_progress'),
      run('publish', 'completed', 'failure'),
    ],
  });
  assert.equal(bots.state, 'pending');
  assert.equal(classifyChecks({ check_runs: [] }).state, 'pending');
  assert.equal(classifyChecks({}).state, 'pending');
});

test('releaseVersionFromTitle extracts the pending version', () => {
  assert.equal(releaseVersionFromTitle('chore(main): release 5.53.0'), '5.53.0');
  assert.equal(releaseVersionFromTitle('chore: release 1.2.3-beta.1'), '1.2.3-beta.1');
  assert.equal(releaseVersionFromTitle('no version here'), null);
  assert.equal(releaseVersionFromTitle(null), null);
});
