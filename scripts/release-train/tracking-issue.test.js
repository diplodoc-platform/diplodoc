#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  backlinkMarker,
  normalizeTrainId,
  parseTrainState,
  renderBacklinkBody,
  renderIssueBody,
  renderStateBlock,
  resolveTrainId,
  trainIssueTitle,
  trainLabel,
} from './tracking-issue.js';

test('normalizeTrainId allows safe ids and rejects the rest', () => {
  assert.equal(normalizeTrainId('rt-42'), 'rt-42');
  assert.equal(normalizeTrainId('  rt_1.2  '), 'rt_1.2');
  assert.equal(normalizeTrainId(''), null);
  assert.equal(normalizeTrainId(undefined), null);
  assert.throws(() => normalizeTrainId('rt 42'), /Invalid train_id/);
  assert.throws(() => normalizeTrainId('rt/42'), /Invalid train_id/);
  assert.throws(() => normalizeTrainId('-rt'), /Invalid train_id/);
});

test('resolveTrainId prefers the manual id', () => {
  assert.equal(resolveTrainId('rt-7', '99'), 'rt-7');
  assert.equal(resolveTrainId('', '99'), 'rt-99');
  assert.equal(resolveTrainId(null, 12), 'rt-12');
  assert.throws(() => resolveTrainId('', ''), /Cannot generate train_id/);
});

test('label and title are derived from the train id', () => {
  assert.equal(trainLabel('rt-3'), 'release-train:rt-3');
  assert.equal(trainIssueTitle('rt-3'), 'Release train: rt-3');
  assert.equal(backlinkMarker('rt-3'), '<!-- release-train-link:rt-3 -->');
});

test('RT-STATE round-trips through render and parse', () => {
  const state = { version: 1, trainId: 'rt-1', state: { packages: [{ repo: 'cli' }] } };
  const body = ['## Report', '', renderStateBlock(state)].join('\n');
  assert.deepEqual(parseTrainState(body), state);
});

test('RT-STATE survives payloads containing comment markers', () => {
  const state = { version: 1, trainId: 'rt-1', error: 'boom --> <!-- oops' };
  const body = renderStateBlock(state);
  assert.equal(body.indexOf('RT-STATE -->'), body.lastIndexOf('RT-STATE -->'));
  assert.deepEqual(parseTrainState(body), state);
});

test('parseTrainState tolerates missing or broken blocks', () => {
  assert.equal(parseTrainState(''), null);
  assert.equal(parseTrainState('no state here'), null);
  assert.equal(parseTrainState('<!-- RT-STATE\n{oops\nRT-STATE -->'), null);
});

test('renderIssueBody includes report, graph, hint and hidden state', () => {
  const state = {
    trainId: 'rt-5',
    packages: [{ repo: 'cli', status: 'queued', ci: { state: 'pending' } }],
  };
  const body = renderIssueBody({
    trainId: 'rt-5',
    state,
    workflow: { runUrl: 'https://example.test/run/1' },
    graph: 'flowchart LR\n    n0[cli queued]',
    rtState: { version: 1, trainId: 'rt-5' },
  });

  assert.match(body, /## Release train: rt-5/);
  assert.match(body, /\*\*Train:\*\* `rt-5`/);
  assert.match(body, /```mermaid/);
  assert.match(body, /\/rt resume/);
  assert.deepEqual(parseTrainState(body), { version: 1, trainId: 'rt-5' });
});

test('renderIssueBody renders diagnostics when provided', () => {
  const body = renderIssueBody({
    trainId: 'rt-6',
    state: { packages: [] },
    diagnostics: { message: 'Cannot add upstream utils', graph: 'flowchart LR\n    n0[utils added]' },
    rtState: null,
  });
  assert.match(body, /### Diagnostics/);
  assert.match(body, /Cannot add upstream utils/);
});

test('a fake RT-STATE block in untrusted text cannot shadow the real one', () => {
  const forged = '<!-- RT-STATE\n{"version":1,"trainId":"evil"}\nRT-STATE -->';
  const body = renderIssueBody({
    trainId: 'rt-8',
    state: { packages: [] },
    diagnostics: { message: `merge failed: ${forged}` },
    rtState: { version: 1, trainId: 'rt-8' },
  });

  assert.deepEqual(parseTrainState(body), { version: 1, trainId: 'rt-8' });
  assert.match(body, /&lt;!-- RT-STATE/);
});

test('backlink body carries the marker and the dashboard link', () => {
  const body = renderBacklinkBody({ trainId: 'rt-9', issueUrl: 'https://example.test/issues/1' });
  assert.match(body, /<!-- release-train-link:rt-9 -->/);
  assert.match(body, /https:\/\/example\.test\/issues\/1/);
});
