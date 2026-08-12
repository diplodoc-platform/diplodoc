#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockedByFailure,
  buildTrainDag,
  downstreamOf,
  readyRepos,
  resolveConcurrency,
  trainEdges,
} from './scheduler.js';

// utils and ajv are independent roots; client depends on utils; cli depends on
// client and ajv. Edges point from the dependent package to its dependency.
const GRAPH = {
  edges: [
    { from: '@diplodoc/client', to: '@diplodoc/utils', type: 'prod' },
    { from: '@diplodoc/cli', to: '@diplodoc/client', type: 'prod' },
    { from: '@diplodoc/cli', to: '@diplodoc/ajv', type: 'prod' },
    { from: '@diplodoc/cli', to: '@diplodoc/utils', type: 'dev' },
    // A package outside the train must not create an edge.
    { from: '@diplodoc/vsc', to: '@diplodoc/cli', type: 'prod' },
  ],
};

const NODES = new Map(
  [
    ['utils', '@diplodoc/utils'],
    ['ajv', '@diplodoc/ajv'],
    ['client', '@diplodoc/client'],
    ['cli', '@diplodoc/cli'],
  ].map(([repo, npm]) => [repo, { repo, npm }]),
);

const PACKAGES = [{ repo: 'utils' }, { repo: 'ajv' }, { repo: 'client' }, { repo: 'cli' }];

function makeDag() {
  return buildTrainDag(PACKAGES, GRAPH, NODES);
}

test('buildTrainDag records in-train upstreams only', () => {
  const dag = makeDag();
  assert.deepEqual([...dag.get('utils')], []);
  assert.deepEqual([...dag.get('ajv')], []);
  assert.deepEqual([...dag.get('client')], ['utils']);
  assert.deepEqual([...dag.get('cli')].sort(), ['ajv', 'client', 'utils']);
  assert.equal(dag.has('vsc'), false);
});

test('trainEdges points from upstream to downstream', () => {
  const edges = trainEdges(makeDag());
  assert.ok(edges.some((e) => e.from === 'utils' && e.to === 'client'));
  assert.ok(edges.some((e) => e.from === 'client' && e.to === 'cli'));
  assert.equal(edges.some((e) => e.from === 'cli'), false);
});

test('readyRepos returns independent roots first, then unblocked packages', () => {
  const dag = makeDag();
  const statuses = { utils: 'queued', ajv: 'queued', client: 'queued', cli: 'queued' };
  const statusOf = (repo) => statuses[repo];

  assert.deepEqual(readyRepos({ packages: PACKAGES, dag, statusOf }), ['utils', 'ajv']);

  statuses.utils = 'released';
  assert.deepEqual(readyRepos({ packages: PACKAGES, dag, statusOf }), ['ajv', 'client']);

  statuses.ajv = 'done';
  statuses.client = 'done';
  assert.deepEqual(readyRepos({ packages: PACKAGES, dag, statusOf }), ['cli']);
});

test('readyRepos skips running and terminal packages', () => {
  const dag = makeDag();
  const statuses = { utils: 'waiting_ci', ajv: 'failed', client: 'queued', cli: 'blocked' };

  assert.deepEqual(
    readyRepos({
      packages: PACKAGES,
      dag,
      statusOf: (repo) => statuses[repo],
      running: new Set(['utils']),
    }),
    [],
  );
});

test('a failure blocks only its transitive dependents', () => {
  const dag = makeDag();
  const statuses = { utils: 'failed', ajv: 'queued', client: 'queued', cli: 'queued' };

  assert.deepEqual([...downstreamOf('utils', dag)].sort(), ['cli', 'client']);
  assert.deepEqual(blockedByFailure('utils', dag, (repo) => statuses[repo]).sort(), ['cli', 'client']);
  // ajv is independent and keeps running.
  assert.deepEqual(blockedByFailure('ajv', dag, (repo) => statuses[repo]), ['cli']);
});

test('blockedByFailure leaves already finished packages alone', () => {
  const dag = makeDag();
  const statuses = { utils: 'failed', ajv: 'done', client: 'done', cli: 'queued' };
  assert.deepEqual(blockedByFailure('utils', dag, (repo) => statuses[repo]), ['cli']);
});

test('resolveConcurrency takes the first usable value and clamps it', () => {
  assert.equal(resolveConcurrency(undefined, 3), 3);
  assert.equal(resolveConcurrency('2', 3), 2);
  assert.equal(resolveConcurrency(null, undefined, 3), 3);
  assert.equal(resolveConcurrency(0, 3), 3, 'zero would stall the scheduler');
  assert.equal(resolveConcurrency('nonsense', 3), 3);
  assert.equal(resolveConcurrency(100), 10);
  assert.equal(resolveConcurrency(), 1);
});
