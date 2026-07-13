#!/usr/bin/env node
/**
 * Minimal tests for deps-graph (node --test scripts/deps-graph.test.js)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDepsGraph, shortId } from './deps-graph.js';

test('shortId strips scope', () => {
  assert.equal(shortId('@diplodoc/cli'), 'cli');
});

test('cli depends on color-extension in graph', () => {
  const graph = buildDepsGraph();
  const edge = graph.edges.find(
    (e) => e.fromShort === 'cli' && e.toShort === 'color-extension',
  );
  assert.ok(edge, 'expected cli --> color-extension edge');
  assert.equal(edge.type, 'prod');
});

test('topoOrder places utils before transform when both present', () => {
  const graph = buildDepsGraph();
  const ui = graph.topoOrder.indexOf('utils');
  const ti = graph.topoOrder.indexOf('transform');
  if (ui >= 0 && ti >= 0) {
    assert.ok(ui < ti, 'utils should precede transform in topo order');
  }
});

test('vsc included via release-train.yml npm alias', () => {
  const graph = buildDepsGraph();
  const vsc = graph.nodes.find((n) => n.repo === 'vsc');
  assert.ok(vsc, 'expected vsc node from release-train.yml');
  assert.equal(vsc.npm, '@diplodoc/vsc');
});
