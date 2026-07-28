#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPrRef, parsePrRef, parsePrRefs } from './pr-refs.js';

const ORG = 'diplodoc-platform';

test('parsePrRef accepts repo#number with default owner', () => {
  assert.deepEqual(parsePrRef('cli#123', ORG), {
    owner: ORG,
    repo: 'cli',
    number: 123,
    raw: 'cli#123',
  });
});

test('parsePrRef accepts owner/repo#number', () => {
  const ref = parsePrRef('diplodoc-platform/transform#4', 'other-org');
  assert.equal(ref.owner, ORG);
  assert.equal(ref.repo, 'transform');
  assert.equal(ref.number, 4);
});

test('parsePrRef accepts PR urls', () => {
  const ref = parsePrRef('https://github.com/diplodoc-platform/cli/pull/77', ORG);
  assert.equal(ref.repo, 'cli');
  assert.equal(ref.number, 77);
});

test('parsePrRef rejects garbage', () => {
  assert.throws(() => parsePrRef('cli', ORG), /Unrecognized PR reference/);
  assert.throws(() => parsePrRef('cli#0', ORG), /Invalid PR number/);
  assert.throws(() => parsePrRef('cli#abc', ORG), /Unrecognized PR reference/);
  assert.throws(() => parsePrRef('bad owner/cli#1', ORG), /Unrecognized PR reference/);
  assert.throws(() => parsePrRef('', ORG), /Empty PR reference/);
});

test('parsePrRefs splits on commas and whitespace and dedupes', () => {
  const refs = parsePrRefs('cli#1, transform#2\nutils#3, cli#1', ORG);
  assert.deepEqual(refs.map(formatPrRef), [
    `${ORG}/cli#1`,
    `${ORG}/transform#2`,
    `${ORG}/utils#3`,
  ]);
});

test('parsePrRefs rejects two PRs for the same repo', () => {
  assert.throws(() => parsePrRefs('cli#1,cli#2', ORG), /Conflicting PRs/);
});

test('parsePrRefs returns empty list for empty input', () => {
  assert.deepEqual(parsePrRefs('', ORG), []);
  assert.deepEqual(parsePrRefs(undefined, ORG), []);
});
