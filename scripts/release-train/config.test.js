import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from './config.js';

// Keep the real repository policy wired through config normalization.
test('only vsc opts out of npm publication waiting', () => {
  const { repos } = loadConfig();
  assert.equal(repos.vsc.wait_for_npm, false);
  assert.ok(Object.values(repos).filter((repo) => repo.slug !== 'vsc')
    .every((repo) => repo.wait_for_npm === true));
});


test('prepare carries the npm policy into a dry-run plan without contacting GitHub', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-train-plan-'));
  try {
    const executable = join(dir, 'gh');
    writeFileSync(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== 'pr' || args[1] !== 'view') throw new Error('Unexpected GitHub operation');
console.log(JSON.stringify({number: Number(args[2]), state: 'OPEN', isDraft: false,
  baseRefName: 'master', headRefName: 'test', url: 'https://github.com/org/repo/pull/1'}));
`);
    chmodSync(executable, 0o755);

    const output = join(dir, 'plan.json');
    execFileSync(process.execPath, ['scripts/release-train/prepare.js',
      '--prs', 'vsc#259,utils#1', '--dry-run', '--no-issue', '--train-id', 'rt-test', '--output', output], {
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`,
        GH_TOKEN: 'test-token', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' },
    });

    const { packages } = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(packages.find((pkg) => pkg.repo === 'vsc').wait_for_npm, false);
    assert.equal(packages.find((pkg) => pkg.repo === 'utils').wait_for_npm, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
