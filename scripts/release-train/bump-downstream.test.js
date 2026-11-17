#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { bumpDownstreamDeps, formatBumpCommitMessage } from './bump-downstream.js';

test('formatBumpCommitMessage lists name@version pairs and links the issue', () => {
  const message = formatBumpCommitMessage({
    trainId: 'rt-11',
    issueRef: { owner: 'diplodoc-platform', repo: 'diplodoc', number: 106 },
    publishedVersions: { '@diplodoc/utils': '1.2.3', '@diplodoc/transform': 'v4.5.6' },
  });
  assert.equal(
    message,
    'chore: bump @diplodoc deps for release train rt-11 ' +
      '(@diplodoc/utils@1.2.3, @diplodoc/transform@4.5.6)\n\n' +
      'Release train: diplodoc-platform/diplodoc#106',
  );
});

test('formatBumpCommitMessage degrades without train id or issue ref', () => {
  assert.equal(
    formatBumpCommitMessage({ publishedVersions: { '@diplodoc/utils': '1.2.3' } }),
    'chore: bump @diplodoc deps for release train (@diplodoc/utils@1.2.3)',
  );
  assert.equal(
    formatBumpCommitMessage({
      trainId: 'rt-1',
      issueRef: { owner: 'o', repo: 'r' },
      publishedVersions: { '@diplodoc/utils': '1.2.3' },
    }),
    'chore: bump @diplodoc deps for release train rt-1 (@diplodoc/utils@1.2.3)',
  );
});


test('controlled bump checks the cloned head and returns exactly its own pushed commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rt-exact-bump-'));
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const bare = join(dir, 'origin.git');
    const source = join(dir, 'source');
    const bin = join(dir, 'bin');
    mkdirSync(source);
    mkdirSync(bin);
    git(dir, 'init', '--bare', bare);
    git(source, 'init', '-b', 'feature');
    git(source, 'config', 'user.name', 'Test');
    git(source, 'config', 'user.email', 'test@example.test');
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        dependencies: { '@diplodoc/utils': '^1.0.0' },
      }),
    );
    git(source, 'add', 'package.json');
    git(source, 'commit', '-m', 'fixture');
    git(source, 'push', bare, 'feature');
    const expectedHead = git(source, 'rev-parse', 'HEAD');
    writeFileSync(
      join(bin, 'gh'),
      `#!${process.execPath}\nconst child=require('node:child_process');const args=process.argv.slice(2);if(args[0]!=='repo'||args[1]!=='clone')throw new Error('Unexpected gh request');child.execFileSync('git',['clone',${JSON.stringify(bare)},args[3]],{stdio:'pipe'});\n`,
      { mode: 0o755 },
    );
    const oldPath = process.env.PATH;
    process.env.PATH = bin + delimiter + oldPath;
    try {
      const options = {
        owner: 'diplodoc-platform',
        token: 'fixture',
        publishedVersions: { '@diplodoc/utils': '2.0.0' },
        updateLockfile: false,
      };
      assert.throws(
        () =>
          bumpDownstreamDeps({
            ...options,
            targets: [
              {
                repo: 'cli',
                featurePr: { number: 1, headRefName: 'feature', expectedHead: '0'.repeat(40) },
              },
            ],
          }),
        /Feature head changed/,
      );
      assert.equal(git(bare, 'rev-parse', 'feature'), expectedHead);
      const result = bumpDownstreamDeps({
        ...options,
        targets: [{ repo: 'cli', featurePr: { number: 1, headRefName: 'feature', expectedHead } }],
      })[0];
      assert.equal(result.bumped, true);
      assert.equal(result.head, git(bare, 'rev-parse', 'feature'));
      assert.equal(git(bare, 'rev-parse', result.head + '^'), expectedHead);
    } finally {
      process.env.PATH = oldPath;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
