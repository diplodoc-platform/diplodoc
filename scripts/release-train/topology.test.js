#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependencyClosure, findMissingUpstream, findUpstreamConflicts } from './topology.js';

// cli → transform → utils
const GRAPH = {
  nodes: [
    { repo: 'utils', npm: '@diplodoc/utils' },
    { repo: 'transform', npm: '@diplodoc/transform' },
    { repo: 'cli', npm: '@diplodoc/cli' },
    { repo: 'testpack', npm: '@diplodoc/testpack' },
  ],
  edges: [
    { from: '@diplodoc/cli', to: '@diplodoc/transform', type: 'prod' },
    { from: '@diplodoc/transform', to: '@diplodoc/utils', type: 'prod' },
    { from: '@diplodoc/cli', to: '@diplodoc/testpack', type: 'dev' },
  ],
};

const nodesByRepo = new Map(GRAPH.nodes.map((n) => [n.repo, n]));
const nodesByNpm = new Map(GRAPH.nodes.map((n) => [n.npm, n]));

test('dependencyClosure follows edges transitively', () => {
  assert.deepEqual(
    [...dependencyClosure('@diplodoc/cli', GRAPH)].sort(),
    ['@diplodoc/testpack', '@diplodoc/transform', '@diplodoc/utils'],
  );
  assert.deepEqual([...dependencyClosure('@diplodoc/utils', GRAPH)], []);
});

test('dependencyClosure can be restricted to edge types', () => {
  assert.deepEqual(
    [...dependencyClosure('@diplodoc/cli', GRAPH, { types: ['prod'] })].sort(),
    ['@diplodoc/transform', '@diplodoc/utils'],
  );
});

test('adding an upstream of an already released package is a conflict', () => {
  const conflicts = findUpstreamConflicts({
    newRepos: ['utils'],
    completedRepos: ['cli'],
    graph: GRAPH,
    nodesByRepo,
    nodesByNpm,
  });
  assert.deepEqual(conflicts, [
    { upstream: 'utils', downstream: 'cli', npm: '@diplodoc/utils' },
  ]);
});

test('adding a downstream package after a release is allowed', () => {
  const conflicts = findUpstreamConflicts({
    newRepos: ['cli'],
    completedRepos: ['utils'],
    graph: GRAPH,
    nodesByRepo,
    nodesByNpm,
  });
  assert.deepEqual(conflicts, []);
});

test('findMissingUpstream only flags changing dependencies left out of the train', () => {
  const ordered = [{ repo: 'cli' }];

  // transform has its own PR but was excluded → error
  assert.deepEqual(
    findMissingUpstream({
      ordered,
      selectedSet: new Set(['cli']),
      discoveredSet: new Set(['cli', 'transform']),
      graph: GRAPH,
      nodesByRepo,
      nodesByNpm,
    }),
    [{ consumer: 'cli', upstream: 'transform', npm: '@diplodoc/transform' }],
  );

  // transform is not changing → fine
  assert.deepEqual(
    findMissingUpstream({
      ordered,
      selectedSet: new Set(['cli']),
      discoveredSet: new Set(['cli']),
      graph: GRAPH,
      nodesByRepo,
      nodesByNpm,
    }),
    [],
  );
});
