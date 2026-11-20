import assert from 'node:assert/strict';
import test from 'node:test';

import { candidateBranch, parsePlacementComment, pendingCandidates, validatePlacement } from './submodule-onboarding.js';

test('only an exact placement command supplies a path', () => {
  assert.equal(parsePlacementComment('/submodule-path packages/screencaster\n'), 'packages/screencaster');
  assert.equal(parsePlacementComment('/submodule-path extensions/notes'), 'extensions/notes');
  for (const unsupported of [
    'Please use /submodule-path devops/example',
    '/submodule-path packages/../example',
    '/submodule-path /tmp/path',
    '/submodule-path packages/example packages/extra',
    '/submodule-path packages/example\nmore text',
  ]) {
    assert.equal(parsePlacementComment(unsupported), undefined);
  }
});

test('validates placement against the package name and repository layout', () => {
  const workspace = { files: new Set(), pkg: { name: '@diplodoc/example-extension' } };
  const slug = 'diplodoc-platform/example-extension';
  assert.equal(validatePlacement(slug, 'extensions/example', workspace), true);
  assert.equal(validatePlacement(slug, 'devops/example-extension', workspace), true);
  assert.throws(() => validatePlacement(slug, 'extensions/other', workspace), /incompatible/);
  assert.throws(() => validatePlacement(slug, 'extensions/example', { ...workspace, pkg: { ...workspace.pkg, private: true } }), /incompatible/);
  assert.throws(() => validatePlacement(slug, '../example', workspace), /Invalid submodule path/);
  assert.equal(validatePlacement('diplodoc-platform/skills', 'skills', { files: new Set() }), false);
  assert.equal(validatePlacement('diplodoc-platform/example-action', 'actions/example', { files: new Set(['action.yml']) }), false);
});

test('a repeat inventory skips existing open or closed requests by immutable GitHub ID', () => {
  const items = [
    { id: 1, slug: 'diplodoc-platform/renamed', path: 'packages/renamed' },
    { id: 2, slug: 'diplodoc-platform/closed' },
    { id: 3, slug: 'diplodoc-platform/new', path: 'packages/new' },
    { id: 4, slug: 'diplodoc-platform/unknown' },
  ];
  const existing = new Map([
    [candidateBranch(1), [{ state: 'open', html_url: 'https://example.com/1' }]],
    [candidateBranch(2), [{ state: 'closed', html_url: 'https://example.com/2' }]],
  ]);
  const lookup = (branch) => existing.get(branch) ?? [];

  assert.deepEqual(pendingCandidates(items, lookup), items.slice(2));
  for (const { id } of items.slice(2)) {
    existing.set(candidateBranch(id), [{ state: 'open', html_url: 'https://example.com/' + id }]);
  }
  assert.deepEqual(pendingCandidates(items, lookup), []);
});

test('an explicit manual retry recreates only selected closed, unmerged requests', () => {
  const items = ['closed', 'open', 'merged', 'unselected'].map((name, index) => ({
    id: index + 1,
    slug: 'diplodoc-platform/' + name,
  }));
  const closed = { state: 'closed', merged_at: null, head: { sha: 'old-head' } };
  const history = new Map([
    [candidateBranch(1), [closed]],
    [candidateBranch(2), [closed, { state: 'open' }]],
    [candidateBranch(3), [{ ...closed, merged_at: '2026-11-20T12:00:00Z' }]],
    [candidateBranch(4), [closed]],
  ]);
  const retry = new Set(items.slice(0, 3).map(({ slug }) => slug));

  assert.deepEqual(pendingCandidates(items, (branch) => history.get(branch), retry), [
    { ...items[0], retryHead: 'old-head' },
  ]);
});
