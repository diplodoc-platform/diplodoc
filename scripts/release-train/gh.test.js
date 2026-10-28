import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';

// Run against an isolated fake executable: these tests must never merge a PR.
test('merge helpers pass the checked head to GitHub without bypassing protection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-train-gh-'));
  try {
    const log = join(dir, 'args.jsonl');
    const executable = join(dir, 'gh');
    writeFileSync(executable, `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.TRAIN_TEST_ARGS, JSON.stringify(process.argv.slice(2)) + '\\n');
`);
    chmodSync(executable, 0o755);

    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { mergePr, enableAutoMerge } from ${JSON.stringify(new URL('./gh.js', import.meta.url).href)};
      const head = 'f05569d9c40208a91066b2f4318fc2968b9bba2d';
      mergePr('org', 'repo', 113, 'rebase', 'test-token', head);
      enableAutoMerge('org', 'repo', 113, 'rebase', 'test-token', head);
      mergePr('org', 'repo', 112, 'squash', 'test-token');
    `], { env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, TRAIN_TEST_ARGS: log } });

    const args = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const head = 'f05569d9c40208a91066b2f4318fc2968b9bba2d';
    assert.deepEqual(args, [
      ['pr', 'merge', '113', '--repo', 'org/repo', '--rebase', '--match-head-commit', head],
      ['pr', 'merge', '113', '--repo', 'org/repo', '--auto', '--rebase', '--match-head-commit', head],
      ['pr', 'merge', '112', '--repo', 'org/repo', '--squash'],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
