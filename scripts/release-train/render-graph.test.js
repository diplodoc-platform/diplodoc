#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { label, mermaidBlock, renderConflictGraph, renderProgressGraph, statusClass } from './render-graph.js';

test('statusClass maps train statuses to graph classes', () => {
  assert.equal(statusClass('done'), 'done');
  assert.equal(statusClass('released'), 'done');
  assert.equal(statusClass('queued'), 'queued');
  assert.equal(statusClass('queued (dry-run)'), 'queued');
  assert.equal(statusClass('failed'), 'failed');
  assert.equal(statusClass('skipped'), 'skipped');
  assert.equal(statusClass('blocked'), 'skipped');
  assert.equal(statusClass('needs_human'), 'queued');
  assert.equal(statusClass('merging'), 'running');
});

test('label strips characters that break mermaid labels', () => {
  assert.equal(label('cli', 'queued (dry-run)'), 'cli queued dry-run');
  assert.equal(label('cli', 'say "hi"'), 'cli say hi');
  assert.equal(label('cli', ''), 'cli');
});

test('label output can never contain HTML comment delimiters', () => {
  // tracking-issue.js treats mermaid blocks as trusted and skips `-->`
  // neutralization there — that is only safe while labels cannot smuggle
  // in `<` or `>`.
  assert.equal(label('re<!--po', 'st-->atus'), 're !--po st-- atus');
  assert.doesNotMatch(label('<!-- RT-STATE', 'x --> y'), /[<>]/);
});

test('renderProgressGraph chains packages in order with status classes', () => {
  const graph = renderProgressGraph([
    { repo: 'utils', status: 'released' },
    { repo: 'cli', status: 'queued' },
  ]);

  assert.match(graph, /^flowchart LR/);
  assert.match(graph, /n0\[utils released]/);
  assert.match(graph, /n1\[cli queued]/);
  assert.match(graph, /n0 --> n1/);
  assert.match(graph, /class n0 done/);
  assert.match(graph, /class n1 queued/);
  assert.equal(renderProgressGraph([]), '');
});

test('renderProgressGraph draws the dependency DAG when edges are given', () => {
  const graph = renderProgressGraph(
    [
      { repo: 'utils', status: 'released' },
      { repo: 'ajv', status: 'queued' },
      { repo: 'cli', status: 'queued' },
    ],
    {
      edges: [
        { from: 'utils', to: 'cli' },
        { from: 'ajv', to: 'cli' },
        // Duplicates and unknown repos must not reach the diagram.
        { from: 'utils', to: 'cli' },
        { from: 'vsc', to: 'cli' },
      ],
    },
  );

  assert.match(graph, /n0 --> n2/);
  assert.match(graph, /n1 --> n2/);
  assert.equal(graph.match(/n0 --> n2/g).length, 1);
  assert.doesNotMatch(graph, /n0 --> n1/, 'independent roots are not chained');
});

test('renderConflictGraph highlights the added upstream and the bad edge', () => {
  const graph = renderConflictGraph({
    packages: [
      { repo: 'cli', status: 'released' },
      { repo: 'utils', status: 'queued' },
    ],
    conflicts: [{ upstream: 'utils', downstream: 'cli' }],
  });

  assert.match(graph, /class n0 done/);
  assert.match(graph, /class n1 conflict/);
  assert.match(graph, /n1 --> n0/);
  assert.match(graph, /linkStyle 0 stroke:#cf1322/);
  assert.equal(renderConflictGraph({ packages: [], conflicts: [] }), '');
});

test('mermaidBlock wraps only non-empty graphs', () => {
  assert.equal(mermaidBlock(''), '');
  assert.equal(mermaidBlock('flowchart LR'), '```mermaid\nflowchart LR\n```');
});
