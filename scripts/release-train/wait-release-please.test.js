import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForReleasePleaseMerge } from './wait-release-please.js';

const HEAD = 'f05569d9c40208a91066b2f4318fc2968b9bba2d';
const OPTIONS = {
  owner: 'diplodoc-platform', repo: 'page-constructor-extension', token: 'token',
  approverToken: 'approver', autoApprove: true, mergeMethod: 'rebase',
};
const CONFIG = {
  name: '.github/dependabot.yml', app: { id: 29110, slug: 'dependabot' }, status: 'queued',
};
const GREEN = { name: 'Quality', status: 'completed', conclusion: 'success' };
const OPEN = {
  state: 'OPEN', headRefOid: HEAD, mergeStateStatus: 'UNSTABLE', autoMergeRequest: null,
  statusCheckRollup: [{ __typename: 'CheckRun' }],
};

function fixture({ prs = [OPEN, { state: 'MERGED' }], checks = [GREEN, CONFIG], ...overrides } = {}) {
  const calls = [];
  let prIndex = 0;
  const deps = {
    findReleasePleasePr: () => ({ number: 113, url: 'https://example.test/113', title: 'release 0.13.17' }),
    getPr: () => prs[Math.min(prIndex++, prs.length - 1)],
    listCheckRuns: (...args) => {
      calls.push(['checks', ...args]);
      return { check_runs: checks };
    },
    approvePr: (...args) => calls.push(['approve', ...args]),
    mergePr: (...args) => calls.push(['merge', ...args]),
    enableAutoMerge: (...args) => {
      calls.push(['auto', ...args]);
      return true;
    },
    pollUntil: async ({ check, onTimeout }) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await check();
        if (result) return result;
      }
      throw onTimeout();
    },
    ...overrides,
  };
  return { calls, deps };
}

const mergeCalls = (calls) => calls.filter(([name]) => name === 'auto' || name === 'merge');

test('release PR with only native config pending uses protected merge on the checked head', async () => {
  const { calls, deps } = fixture();
  const result = await waitForReleasePleaseMerge(OPTIONS, deps);

  assert.equal(result.merged, true);
  assert.deepEqual(mergeCalls(calls), [
    ['merge', OPTIONS.owner, OPTIONS.repo, 113, 'rebase', 'token', HEAD],
  ]);
  assert.deepEqual(calls.find(([name]) => name === 'checks'),
    ['checks', OPTIONS.owner, OPTIONS.repo, HEAD, 'token']);
});

test('transient auto-merge refusal is retried after refreshing PR and CI', async () => {
  let attempts = 0;
  const { calls, deps } = fixture({
    prs: [{ ...OPEN, mergeStateStatus: 'CLEAN' }, { ...OPEN, mergeStateStatus: 'CLEAN' }, { state: 'MERGED' }],
    checks: [GREEN],
    enableAutoMerge: (...args) => {
      calls.push(['auto', ...args]);
      return ++attempts > 1;
    },
  });
  await waitForReleasePleaseMerge(OPTIONS, deps);

  assert.equal(attempts, 2);
  assert.equal(calls.filter(([name]) => name === 'checks').length, 2);
  assert.ok(mergeCalls(calls).every((args) => args.at(-1) === HEAD));
  assert.equal(calls.filter(([name]) => name === 'approve').length, 1);
});

test('real pending, failed, missing CI and untrusted same-name checks block automatic merge', async () => {
  for (const checks of [
    [], [CONFIG],
    [GREEN, CONFIG, { name: 'Internal Check', status: 'in_progress' }],
    [GREEN, CONFIG, { name: 'Internal Check', status: 'completed', conclusion: 'failure' }],
    [GREEN, { ...CONFIG, status: 'completed', conclusion: 'failure' }],
    [GREEN, { ...CONFIG, app: { id: 15368, slug: 'github-actions' } }],
    [GREEN, { ...CONFIG, app: undefined }],
  ]) {
    const { calls, deps } = fixture({ prs: [OPEN], checks });
    await assert.rejects(waitForReleasePleaseMerge(OPTIONS, deps), /not merged within/);
    assert.deepEqual(mergeCalls(calls), [], JSON.stringify(checks));
  }
});

test('legacy Internal Check and unknown status rollups fail closed', async () => {
  for (const statusCheckRollup of [
    undefined,
    [{ __typename: 'StatusContext', context: 'Internal Check', state: 'PENDING' }],
    [{ __typename: 'StatusContext', context: 'Internal Check', state: 'FAILURE' }],
    [{ __typename: 'UnknownStatus' }],
  ]) {
    const { calls, deps } = fixture({ prs: [{ ...OPEN, statusCheckRollup }] });
    await assert.rejects(waitForReleasePleaseMerge(OPTIONS, deps), /not merged within/);
    assert.deepEqual(mergeCalls(calls), []);
  }

  const { calls, deps } = fixture({ prs: [
    { ...OPEN, statusCheckRollup: [{ __typename: 'StatusContext', state: 'SUCCESS' }] },
    { state: 'MERGED' },
  ] });
  await waitForReleasePleaseMerge(OPTIONS, deps);
  assert.equal(mergeCalls(calls).length, 1);
});

test('changed head is checked again and pending CI prevents another merge attempt', async () => {
  const nextHead = 'a'.repeat(40);
  const { calls, deps } = fixture({
    prs: [OPEN, { ...OPEN, headRefOid: nextHead }],
    mergePr: (...args) => {
      calls.push(['merge', ...args]);
      throw new Error('Head changed; expected head does not match');
    },
    listCheckRuns: (owner, repo, head) => ({ check_runs: head === HEAD ? [GREEN, CONFIG] : [] }),
  });
  await assert.rejects(waitForReleasePleaseMerge(OPTIONS, deps), /not merged within/);
  assert.equal(mergeCalls(calls).length, 1);
  assert.equal(mergeCalls(calls)[0].at(-1), HEAD);
});

test('protected merge refusal never reports success or switches to admin merge', async () => {
  const { calls, deps } = fixture({
    prs: [OPEN],
    mergePr: (...args) => {
      calls.push(['merge', ...args]);
      throw new Error('Base branch policy prohibits the merge');
    },
  });
  await assert.rejects(waitForReleasePleaseMerge(OPTIONS, deps), /not merged within/);
  assert.ok(mergeCalls(calls).length > 0);
  assert.ok(mergeCalls(calls).every(([name]) => name === 'merge'));
});

test('manual mode and missing approver credentials never mutate the release PR', async () => {
  for (const options of [{ ...OPTIONS, autoApprove: false }, { ...OPTIONS, approverToken: null }]) {
    const { calls, deps } = fixture({ prs: [OPEN] });
    if (!options.autoApprove) {
      const result = await waitForReleasePleaseMerge(options, deps);
      assert.equal(result.waitingManual, true);
    } else {
      await assert.rejects(waitForReleasePleaseMerge(options, deps), /not merged within/);
    }
    assert.deepEqual(calls, []);
  }
});

test('already armed auto-merge is left to GitHub and closed release PR fails explicitly', async () => {
  const { calls, deps } = fixture({ prs: [{ ...OPEN, autoMergeRequest: { enabledAt: 'now' } }, { state: 'MERGED' }] });
  assert.equal((await waitForReleasePleaseMerge(OPTIONS, deps)).merged, true);
  assert.deepEqual(mergeCalls(calls), []);

  const closed = fixture({ prs: [{ state: 'CLOSED' }] });
  await assert.rejects(waitForReleasePleaseMerge(OPTIONS, closed.deps), /closed without merge/);
  assert.deepEqual(mergeCalls(closed.calls), []);
});
