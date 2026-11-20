import assert from 'node:assert/strict';
import test from 'node:test';

import { discover, parseIgnore, suggestPath } from './submodule-discovery.js';

const owner = 'diplodoc-platform/';
const repo = (name, fields) => ({ full_name: owner + name, visibility: 'public', ...fields });
const contents = (name, paths = []) => ({
  files: new Set(paths),
  pkg: name ? { name: '@diplodoc/' + name } : undefined,
});

test('uses exact repository identities for registered modules and exceptions', () => {
  const ignored = parseIgnore('\n# Ignore old projects\n' +
    'git@github.com:diplodoc-platform/markdown-translation-action.git # old action\n' +
    'https://github.com/diplodoc-platform/MDX-extension.git\n' +
    'example\n');
  assert(!ignored.has(owner + 'translation'));
  assert(ignored.has(owner + 'mdx-extension'));
  assert(ignored.has(owner + 'example'));

  const inventory = ['translation', 'markdown-translation-action', 'old-extension', 'diplodoc'].map((name) => repo(name));
  const linked = [{ slug: owner + 'old-extension', path: 'extensions/custom' }];
  const result = discover(inventory, linked, ignored, (item) => {
    assert.equal(item.full_name, owner + 'translation');
    return contents('translation');
  }, () => false);
  assert.deepEqual(result.additions.map(({ path }) => path), ['packages/translation']);
  assert.deepEqual(result.absent, []);
});

test('suggests placements using repository content and matching package names', () => {
  assert.equal(suggestPath('notes-extension', contents('notes-extension')).path, 'extensions/notes');
  assert.equal(suggestPath('screencaster', contents('screencaster')).path, 'packages/screencaster');
  assert.equal(suggestPath('docs-action', contents(null, ['action.yaml'])).path, 'actions/docs');
  assert.equal(suggestPath('skills', contents(null, ['.claude-plugin', 'skills'])).path, 'skills');
  assert.equal(suggestPath('fake-extension', contents('other')).path, undefined);
  assert.equal(suggestPath('eslint-config', contents('eslint-config')).path, undefined);
  assert.equal(suggestPath('private', { files: new Set(), pkg: { name: '@diplodoc/private', private: true } }).path, undefined);
});

test('reports private, archived, missing and colliding entries for review', () => {
  const inventory = [
    repo('foo'), repo('foo-action'), repo('nested'), repo('archived', { archived: true }),
    repo('notes-extension', { visibility: 'private' }), repo('example', { is_template: true }),
  ];
  const linked = [
    { slug: owner + 'archived', path: 'packages/archived' },
    { slug: owner + 'missing', path: 'packages/missing' },
  ];
  const inspected = [];
  const result = discover(inventory, linked, new Set(), (item) => {
    inspected.push(item.full_name);
    if (item.full_name.endsWith('/nested')) return contents('nested');
    return contents(null, ['action.yml']);
  }, (path) => path === 'packages/nested');

  assert.deepEqual(inspected, ['foo', 'foo-action', 'nested'].map((name) => owner + name));
  assert.deepEqual(result.additions, []);
  assert.deepEqual(result.manual.map(({ slug }) => slug), ['example', 'foo', 'foo-action', 'nested', 'notes-extension'].map((name) => owner + name));
  assert.deepEqual(result.inactive, [linked[0]]);
  assert.deepEqual(result.absent, [linked[1]]);
});

test('fails when repository metadata cannot be read', () => {
  assert.throws(() => discover([repo('candidate')], [], new Set(), () => {
    throw new Error('GitHub API error');
  }), /GitHub API error/);
});
